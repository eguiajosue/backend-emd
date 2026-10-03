import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DataChange, PrismaService } from '../prisma/prisma.service';
import { PRODUCTION_AREAS } from '../order/dto/create-order.dto';
import { STATUS_NAME_CANCELADO } from '../order/status-id-resolver';
import {
  buildClientProfile,
  ClientProfile,
  ENGINE_VERSION,
  MAX_ORDERS_ANALYZED,
} from './client-insight.engine';

/** Un perfil guardado hace más de esto se recalcula al pedirlo (la recencia cambia con el tiempo). */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Las escrituras de un mismo alta/cambio se aprenden juntas, una vez por cliente. */
export const LEARN_DEBOUNCE_MS = 2_000;

/** "Clientes que suelen pedir por estas fechas": ventana alrededor de la fecha estimada. */
const DUE_LOOKBACK_DAYS = 21;
const DUE_LOOKAHEAD_DAYS = 7;
const DAY_MS = 86_400_000;

const LEARNING_ORDER_SELECT = {
  id: true,
  creationDate: true,
  deliveryDate: true,
  requiresDesign: true,
  productionArea: true,
  area: true,
  areaTasks: { select: { area: true } },
  orderProducts: { select: { customName: true, quantity: true } },
  materialItems: {
    select: {
      materialId: true,
      quantity: true,
      description: true,
      supplierId: true,
      material: { select: { name: true, unit: { select: { name: true } } } },
    },
  },
} satisfies Prisma.OrderSelect;

export interface DueClient {
  clientId: number;
  clientName: string;
  lastOrderAt: string | null;
  nextExpectedAt: string;
  medianDays: number;
  /** Lo que más pide (para que Recepción sepa de qué hablarle). */
  topProduct: string | null;
  ordersAnalyzed: number;
}

/** Campos de un pedido que cambian lo que se aprende de su cliente. */
const LEARNING_FIELDS = new Set([
  'clientId',
  'client',
  'statusId',
  'status',
  'deliveryDate',
  'creationDate',
  'requiresDesign',
  'productionArea',
  'area',
  'orderProducts',
]);

/** Id numérico de `where: { id }` / `where: { id: { in } }` (o vacío). */
function idsFromWhere(where: any): number[] {
  const id = where?.id;
  if (typeof id === 'number') return [id];
  if (Array.isArray(id?.in))
    return id.in.filter((n: unknown) => typeof n === 'number');
  return [];
}

/**
 * Aprendizaje por cliente. Guarda en `ClientInsight` el perfil que arma el
 * motor (client-insight.engine.ts) a partir del historial de pedidos del
 * cliente, y lo vuelve a aprender cada vez que ese historial cambia: alta,
 * cambio o borrado de un pedido (un cancelado deja de contar), de sus
 * productos, sus áreas o su hoja de materiales. Se entera por el feed de
 * escrituras de Prisma (`PrismaService.changes`), así que ningún camino que
 * escribe pedidos tiene que acordarse de avisar. El alta de pedido lo usa
 * para autocompletar; el Inicio de Recepción, para "clientes por pedir".
 */
@Injectable()
export class ClientInsightService
  implements OnModuleInit, OnModuleDestroy, OnApplicationBootstrap
{
  private readonly logger = new Logger(ClientInsightService.name);
  private readonly pendingClients = new Set<number>();
  private readonly pendingOrders = new Set<number>();
  private timer: NodeJS.Timeout | null = null;
  private backfillTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private readonly onChange = (change: DataChange) => {
    const result = (change.result ?? {}) as Record<string, any>;
    switch (change.model) {
      case 'Order': {
        // Reordenar prioridades de compra, tomar el pedido, etc. no cambia lo que se aprende.
        const data = change.args?.data;
        if (
          (change.action === 'update' || change.action === 'updateMany') &&
          data &&
          !Object.keys(data).some((k) => LEARNING_FIELDS.has(k))
        ) {
          return;
        }
        if (typeof result.clientId === 'number')
          this.pendingClients.add(result.clientId);
        else
          idsFromWhere(change.args?.where).forEach((id) =>
            this.pendingOrders.add(id),
          );
        break;
      }
      case 'OrderProduct':
      case 'OrderMaterialItem':
      case 'OrderAreaTask': {
        // De las tareas sólo importa qué áreas trabajan el pedido, no su avance.
        if (
          change.model === 'OrderAreaTask' &&
          !['create', 'createMany', 'delete', 'deleteMany'].includes(
            change.action,
          )
        ) {
          return;
        }
        const orderId =
          typeof result.orderId === 'number'
            ? result.orderId
            : change.args?.where?.orderId;
        if (typeof orderId === 'number') this.pendingOrders.add(orderId);
        else if (Array.isArray(change.args?.data)) {
          change.args.data.forEach(
            (d: any) =>
              typeof d?.orderId === 'number' &&
              this.pendingOrders.add(d.orderId),
          );
        } else if (typeof change.args?.data?.orderId === 'number') {
          this.pendingOrders.add(change.args.data.orderId);
        }
        break;
      }
      default:
        return;
    }
    if (this.pendingClients.size + this.pendingOrders.size > 0) {
      this.timer ??= setTimeout(() => void this.flush(), LEARN_DEBOUNCE_MS);
    }
  };

  onModuleInit() {
    this.prisma.changes?.on('change', this.onChange);
  }

  onModuleDestroy() {
    this.prisma.changes?.off('change', this.onChange);
    if (this.timer) clearTimeout(this.timer);
    if (this.backfillTimer) clearTimeout(this.backfillTimer);
    this.timer = null;
    this.backfillTimer = null;
  }

  /** Aprende de todos los clientes tocados desde el último aviso. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const clients = new Set(this.pendingClients);
    const orderIds = [...this.pendingOrders];
    this.pendingClients.clear();
    this.pendingOrders.clear();
    try {
      if (orderIds.length > 0) {
        const orders = await this.prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { clientId: true },
        });
        orders.forEach((o) => o.clientId && clients.add(o.clientId));
      }
      for (const clientId of clients) {
        await this.rebuild(clientId);
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo aprender de los últimos cambios: ${error?.message ?? error}`,
      );
    }
  }

  /**
   * Al arrancar, aprende de los clientes que tienen pedidos pero todavía no
   * tienen perfil (o lo tienen de una versión vieja del motor). En segundo
   * plano: no frena el arranque.
   */
  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    this.backfillTimer = setTimeout(() => {
      this.backfillTimer = null;
      this.backfill().catch((error) =>
        this.logger.warn(
          `No se pudieron aprender los perfiles pendientes: ${error?.message ?? error}`,
        ),
      );
    }, 5_000);
  }

  async backfill(): Promise<number> {
    const clients = await this.prisma.client.findMany({
      where: {
        orders: { some: {} },
        OR: [
          { insight: null },
          { insight: { version: { not: ENGINE_VERSION } } },
        ],
      },
      select: { id: true },
    });
    for (const { id } of clients) {
      await this.rebuild(id);
    }
    if (clients.length > 0) {
      this.logger.log(`Perfiles de cliente aprendidos: ${clients.length}`);
    }
    return clients.length;
  }

  /** Perfil de hábitos del cliente (lo aprende si no existe o quedó viejo). */
  async getProfile(clientId: number): Promise<ClientProfile> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true },
    });
    if (!client) throw new NotFoundException('El cliente no existe');

    const stored = await this.prisma.clientInsight.findUnique({
      where: { clientId },
    });
    const fresh =
      stored &&
      stored.version === ENGINE_VERSION &&
      Date.now() - stored.updatedAt.getTime() < STALE_AFTER_MS;
    if (fresh) return stored.profile as unknown as ClientProfile;
    return this.rebuild(clientId);
  }

  /** Vuelve a aprender el perfil del cliente desde su historial. */
  async rebuild(clientId: number): Promise<ClientProfile> {
    const orders = await this.prisma.order.findMany({
      where: { clientId, status: { name: { not: STATUS_NAME_CANCELADO } } },
      orderBy: { creationDate: 'desc' },
      take: MAX_ORDERS_ANALYZED,
      select: LEARNING_ORDER_SELECT,
    });
    const profile = buildClientProfile(orders, PRODUCTION_AREAS);
    const data = {
      version: profile.version,
      ordersAnalyzed: profile.ordersAnalyzed,
      lastOrderAt: profile.lastOrderAt ? new Date(profile.lastOrderAt) : null,
      nextExpectedAt: profile.cadence
        ? new Date(profile.cadence.nextExpectedAt)
        : null,
      cadenceRegular: profile.cadence?.regular ?? false,
      profile: profile as unknown as Prisma.InputJsonValue,
    };
    try {
      await this.prisma.clientInsight.upsert({
        where: { clientId },
        create: { clientId, ...data },
        update: data,
      });
    } catch (error) {
      // El cliente se borró mientras se aprendía: no hay nada que guardar.
      if (error?.code !== 'P2003' && error?.code !== 'P2025') throw error;
    }
    return profile;
  }

  /**
   * Clientes con un ritmo de pedidos regular cuya fecha estimada del próximo
   * pedido ya llegó o está por llegar (y no volvieron a pedir): para que
   * Recepción se adelante y los contacte.
   */
  async dueClients(now = new Date(), limit = 6): Promise<DueClient[]> {
    const rows = await this.prisma.clientInsight.findMany({
      where: {
        cadenceRegular: true,
        nextExpectedAt: {
          gte: new Date(now.getTime() - DUE_LOOKBACK_DAYS * DAY_MS),
          lte: new Date(now.getTime() + DUE_LOOKAHEAD_DAYS * DAY_MS),
        },
      },
      orderBy: { nextExpectedAt: 'asc' },
      take: limit,
      select: {
        clientId: true,
        lastOrderAt: true,
        nextExpectedAt: true,
        ordersAnalyzed: true,
        profile: true,
        client: { select: { first_name: true, last_name: true } },
      },
    });
    return rows.map((row) => {
      const profile = row.profile as unknown as ClientProfile;
      return {
        clientId: row.clientId,
        clientName: [row.client.first_name, row.client.last_name]
          .filter(Boolean)
          .join(' '),
        lastOrderAt: row.lastOrderAt?.toISOString() ?? null,
        nextExpectedAt: row.nextExpectedAt!.toISOString(),
        medianDays: profile.cadence?.medianDays ?? 0,
        topProduct: profile.products?.[0]?.name ?? null,
        ordersAnalyzed: row.ordersAnalyzed,
      };
    });
  }
}
