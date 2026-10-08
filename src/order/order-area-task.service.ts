import { BRANCH_BADGE_SELECT } from 'src/branch/branch-access';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AreaTaskStatus,
  EmbroideryPrepStage,
  Prisma,
  SampleTestResult,
  SupplySource,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from 'src/notification/notification.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { Role } from 'src/common/enums/roles.enum';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { assertBase64FileValid } from 'src/common/file-validation';
import {
  STORAGE_FOLDERS,
  StorageService,
  type StoredBlob,
} from 'src/storage/storage.service';
import type { OrderFileDto } from './dto/create-order.dto';
import { PRODUCTION_AREAS } from './dto/create-order.dto';
import { AreaSupplyDto } from './dto/order-area-supply.dto';
import {
  SUPPLY_TX_OPTIONS,
  SupplyInventoryResult,
  TASK_SUPPLY_SELECT,
  applySupplyInventoryForStatusTx,
  discountPendingSupplyTx,
  lockTaskStatusTx,
  reservedByItem,
  saveSuppliesTx,
  serializeSupply,
} from './order-area-supply';
import { isBranchOnlyUser } from 'src/branch/branch-access';
import { isFullVisibilityRole, operationalRolesOf } from './role-stage-mapping';
import type { RequestingUser } from './order.service';
import {
  StatusIdResolver,
  STATUS_NAME_AUTORIZADO,
  STATUS_NAME_CAMBIOS_SOLICITADOS,
  STATUS_NAME_CANCELADO,
  STATUS_NAME_EN_DISENO,
  STATUS_NAME_ENTREGADO,
  STATUS_NAME_TERMINADO,
} from './status-id-resolver';

/*
 * Todos los estados globales que toca este servicio se resuelven por NOMBRE
 * (ver StatusIdResolver): sus ids dependen del orden del seed.
 *  - "terminado": listo para entregar, al que pasa el pedido cuando TODAS sus
 *    áreas terminaron. La entrega la confirma Recepción a mano, nunca
 *    automáticamente (WORKFLOW.md §3).
 *  - "autorizado": al que vuelve el pedido si un área RETROCEDE desde
 *    `terminado` estando ya listo para entregar.
 *  - "entregado"/"cancelado": estados finales, que no se pisan.
 */

/**
 * Transiciones válidas del ciclo corto de una tarea de área. Una tarea no
 * puede saltar de pendiente a terminado sin pasar por en_proceso, y se puede
 * retroceder (corregir un clic) pero sólo un paso.
 */
const ALLOWED_TASK_TRANSITIONS: Record<AreaTaskStatus, AreaTaskStatus[]> = {
  [AreaTaskStatus.pendiente]: [AreaTaskStatus.en_proceso],
  [AreaTaskStatus.en_proceso]: [
    AreaTaskStatus.terminado,
    AreaTaskStatus.pendiente,
  ],
  [AreaTaskStatus.terminado]: [AreaTaskStatus.en_proceso],
};

/**
 * Sólo Bordado pasa por las etapas previas a producción (digitalizado →
 * pruebas). WORKFLOW.md §3.1.
 */
const PREP_STAGE_AREA = Role.BORDADO;

/** La foto de la prueba la toma el celular: PNG o JPEG, hasta 5MB. */
const SAMPLE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const SAMPLE_PHOTO_MIME_TYPES = ['image/png', 'image/jpeg'] as const;

/** Una entrada de la bandeja "Tareas asignadas" (ver `findMyTasks`). */
export interface MyTaskItem {
  key: string;
  kind: 'design' | 'production';
  area: string;
  /** Id de la tarea de área; null para Diseño (el trabajo es el pedido). */
  taskId: number | null;
  /** Estado de la tarea de área, o nombre del estado de diseño del pedido. */
  status: string;
  /** Etapa previa a producción de Bordado (digitalizado | en_pruebas); null si ya puede producir. */
  prepStage?: EmbroideryPrepStage | null;
  /**
   * Última ronda de pruebas de Bordado (null si no hay): la tarjeta muestra por
   * qué se rechazó la prueba o cuántas rondas lleva.
   */
  lastTest?: {
    round: number;
    result: SampleTestResult | null;
    sentNotes: string | null;
    resultNotes: string | null;
  } | null;
  /** A nombre de quien la pide (nunca desde la cuenta compartida). */
  mine: boolean;
  /** Responsable si es una persona; null si está libre. */
  assignee: {
    id: number;
    firstName: string | null;
    lastName: string | null;
    username: string;
  } | null;
  startedAt: Date | null;
  /** Origen de insumos del área (hoja de materiales); null si no hay. */
  supply?: unknown;
  order: {
    id: number;
    description: string;
    deliveryDate: Date | null;
    creationDate: Date;
    statusId: number;
    clientNameOverride: string | null;
    designStartedAt: Date | null;
    designStartedByName: string | null;
    client: { first_name: string; last_name: string | null } | null;
    branch: { id: number; name: string } | null;
    status: { id: number; name: string };
  };
}

/** Roles que pueden reasignar cualquier tarea (ver WORKFLOW.md §5). */
/** Cuánto tiempo siguen visibles las tareas terminadas en `findForUser`. */
const FINISHED_TASKS_WINDOW_MS = 24 * 60 * 60 * 1000;

const TASK_MANAGER_ROLES: string[] = [
  Role.RECEPCION,
  Role.ADMIN,
  Role.SUPERUSER,
];

/**
 * Tareas de área de un pedido: el trabajo de producción partido por área,
 * avanzando en paralelo.
 *
 * Cada área lleva su propio estado (pendiente → en_proceso → terminado) y su
 * propio responsable, que por defecto es la cuenta compartida del área para
 * que cualquiera del área pueda tomarla.
 */
@Injectable()
export class OrderAreaTaskService {
  private readonly logger = new Logger(OrderAreaTaskService.name);
  /** Resolución cacheada de ids de Status por nombre. */
  private readonly statusIds: StatusIdResolver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly auditLog: AuditLogService,
    // Lo inyecta siempre StorageModule (global); el default es el modo legacy
    // (todo en la DB) para quien construye el servicio a mano.
    private readonly storage: StorageService = StorageService.database(),
  ) {
    this.statusIds = new StatusIdResolver(this.prisma);
  }

  /** Selección estándar de una tarea, con el responsable resumido. */
  private taskSelect() {
    return {
      id: true,
      orderId: true,
      area: true,
      status: true,
      assignedUserId: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      prepStage: true,
      // Registro de pruebas de bordado (vacío fuera de Bordado).
      sampleTests: {
        orderBy: { round: 'asc' as const },
        select: {
          id: true,
          round: true,
          sentAt: true,
          sentNotes: true,
          photoName: true,
          result: true,
          resultNotes: true,
          decidedAt: true,
          sentBy: { select: { id: true, firstName: true, lastName: true } },
          decidedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      assignedUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          isSharedAccount: true,
        },
      },
      // Origen de insumos del área ("del cliente — 12 playeras negras").
      supply: TASK_SUPPLY_SELECT,
    } satisfies Prisma.OrderAreaTaskSelect;
  }

  /**
   * Las cuentas de sucursal no ven los insumos de inventario (nombres, códigos
   * de barras, cantidades): se quita `supply` de lo que se les devuelve.
   */
  private stripSupplyForBranch<T extends { supply?: unknown }>(
    tasks: T[],
    requestingUser?: RequestingUser,
  ): T[];
  private stripSupplyForBranch<T extends { supply?: unknown }>(
    tasks: T,
    requestingUser?: RequestingUser,
  ): T;
  private stripSupplyForBranch(
    tasks: { supply?: unknown } | { supply?: unknown }[],
    requestingUser?: RequestingUser,
  ) {
    if (!requestingUser || !isBranchOnlyUser(requestingUser.roles)) {
      return tasks;
    }
    const strip = (task: { supply?: unknown }) => {
      const rest = { ...task };
      delete rest.supply;
      return rest;
    };
    return Array.isArray(tasks) ? tasks.map(strip) : strip(tasks);
  }

  /**
   * Cuenta compartida de un área ("Área: Bordado"), usada como responsable por
   * defecto de sus tareas. Si el área no tiene una, la tarea queda sin asignar
   * y la toma quien la trabaje.
   */
  private async sharedAccountIdForArea(
    area: string,
    client: Pick<Prisma.TransactionClient, 'user'> = this.prisma,
  ): Promise<number | null> {
    const shared = await client.user.findFirst({
      where: { isSharedAccount: true, roles: { some: { name: area } } },
      select: { id: true },
    });
    return shared?.id ?? null;
  }

  private assertProductionArea(area: string): void {
    if (!(PRODUCTION_AREAS as readonly string[]).includes(area)) {
      throw new HttpException(
        `"${area}" no es un área de producción válida`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Crea las tareas de las áreas indicadas para un pedido, asignando cada una a
   * la cuenta compartida de su área y notificando SOLO a esa área.
   *
   * Idempotente: las áreas que ya tienen tarea en el pedido se ignoran, así se
   * puede llamar tanto al crear el pedido como al autorizar el montaje, o para
   * sumar un área a mitad de camino.
   */
  async createTasksForAreas(
    orderId: number,
    areas: string[],
    options?: { notify?: boolean; tx?: Prisma.TransactionClient },
  ) {
    const client = options?.tx ?? this.prisma;
    const unique = [...new Set(areas)];
    unique.forEach((area) => this.assertProductionArea(area));

    const existing = await client.orderAreaTask.findMany({
      where: { orderId },
      select: { area: true },
    });
    const existingAreas = new Set(existing.map((t) => t.area));
    const toCreate = unique.filter((area) => !existingAreas.has(area));
    if (toCreate.length === 0) return [];

    const created = await Promise.all(
      toCreate.map(async (area) => {
        const assignedUserId = await this.sharedAccountIdForArea(area, client);
        return client.orderAreaTask.create({
          data: {
            orderId,
            area,
            assignedUserId,
            // Bordado arranca en digitalización (WORKFLOW.md §3.1).
            ...(area === PREP_STAGE_AREA && {
              prepStage: EmbroideryPrepStage.digitalizado,
            }),
          },
          select: this.taskSelect(),
        });
      }),
    );

    if (options?.notify !== false) {
      await Promise.all(
        toCreate.map((area) => this.notifyAreaOfNewTask(orderId, area)),
      );
    }
    return created;
  }

  /** Aviso de tarea nueva, dirigido sólo al área que le toca (WORKFLOW.md §3). */
  private async notifyAreaOfNewTask(orderId: number, area: string) {
    const areaUserIds = await this.notificationService.userIdsForArea(area);
    await this.notificationService.createNotificationForUsers(areaUserIds, {
      type: 'area_task_created',
      title: `Nueva tarea de ${area}`,
      body: `Pedido #${orderId}: hay trabajo pendiente para ${area}`,
      orderId,
    });
    // La fecha de entrega deja que el Modo TV elija color/animación al
    // instante, sin esperar a recargar la lista.
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { deliveryDate: true },
    });
    this.notificationsGateway.notifyNewOrderToArea(area, {
      orderId,
      description: `Nueva tarea de ${area} en el pedido #${orderId}`,
      area,
      deliveryDate: order?.deliveryDate ?? null,
    });
  }

  /**
   * Tareas de producción visibles para un usuario: SOLO las de sus propias
   * áreas (WORKFLOW.md §4). Si es bordador y laserista ve Bordado y Láser
   * mezcladas, cada una etiquetada con su área; nunca las de otras.
   *
   * Recepción/admin ven todas, porque siguen el avance global.
   *
   * El frontend decide con esta misma lista si mostrarlas todas juntas o
   * agrupadas por área, según la preferencia personal del usuario.
   */
  async findForUser(requestingUser: RequestingUser) {
    const closedStatusIds = await this.finalStatusIds();
    const isManager = requestingUser.roles.some((r) =>
      TASK_MANAGER_ROLES.includes(r),
    );
    const ownAreas = requestingUser.roles.filter((role) =>
      (PRODUCTION_AREAS as readonly string[]).includes(role),
    );

    // Un usuario sin áreas de producción ni rol de gestión no tiene tareas
    // propias que ver (ej. sólo Diseño): lista vacía en vez de todas.
    if (!isManager && ownAreas.length === 0) return [];

    // Lo terminado sólo interesa reciente (columna "Terminado" del Modo TV):
    // así la respuesta no crece sin límite.
    const finishedSince = new Date(Date.now() - FINISHED_TASKS_WINDOW_MS);
    const tasks = await this.prisma.orderAreaTask.findMany({
      where: {
        ...(isManager ? {} : { area: { in: ownAreas } }),
        // Los pedidos cerrados no ensucian la bandeja de trabajo, y las tareas
        // planificadas mientras el pedido sigue en Diseño todavía no son
        // trabajo (mismo criterio que `findMyTasks`).
        order: {
          statusId: { notIn: closedStatusIds },
          NOT: { area: Role.DISENO },
        },
        OR: [
          { status: { not: AreaTaskStatus.terminado } },
          { completedAt: { gte: finishedSince } },
        ],
      },
      select: {
        ...this.taskSelect(),
        order: {
          select: {
            id: true,
            description: true,
            deliveryDate: true,
            creationDate: true,
            area: true,
            statusId: true,
            status: { select: { id: true, name: true } },
            clientNameOverride: true,
            client: { select: { first_name: true, last_name: true } },
            // Badge "Punto Madero" en el tablero de tareas / TV.
            branch: BRANCH_BADGE_SELECT,
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
    return this.stripSupplyForBranch(tasks, requestingUser);
  }

  /**
   * GET /orders/my-tasks — la bandeja de "Tareas asignadas" de Diseño y
   * Producción: una entrada por TAREA (no por pedido), de todas las áreas del
   * usuario. Sólo lo suyo y lo libre de sus áreas (sin responsable o en la
   * cuenta compartida del área); lo que ya tomó un compañero no aparece.
   *
   * - Diseño: pedidos en "en diseño" o "cambios solicitados" (lo que espera
   *   respuesta del cliente no es trabajo de Diseño).
   * - Producción: tareas de área sin terminar, de pedidos que ya salieron de
   *   Diseño (las planificadas antes de la autorización todavía no son
   *   trabajo) y no están cerrados.
   *
   * Desde la cuenta compartida de un área nada cuenta como "tuyo": todo lo
   * del área aparece como libre.
   */
  async findMyTasks(requestingUser: RequestingUser) {
    const me = await this.prisma.user.findUnique({
      where: { id: requestingUser.userId },
      select: { isSharedAccount: true },
    });
    const isSharedLogin = me?.isSharedAccount === true;
    const productionAreas = requestingUser.roles.filter((role) =>
      (PRODUCTION_AREAS as readonly string[]).includes(role),
    );
    const designs = requestingUser.roles.includes(Role.DISENO);

    const sharedAccounts = await this.prisma.user.findMany({
      where: { isSharedAccount: true },
      select: { id: true },
    });
    const sharedIds = new Set(sharedAccounts.map((u) => u.id));
    const isFree = (assignedUserId: number | null) =>
      assignedUserId === null || sharedIds.has(assignedUserId);
    const isMine = (assignedUserId: number | null) =>
      !isSharedLogin && assignedUserId === requestingUser.userId;
    const visibleTo = (assignedUserId: number | null) =>
      isFree(assignedUserId) || isMine(assignedUserId);

    const orderSelect = {
      id: true,
      description: true,
      deliveryDate: true,
      creationDate: true,
      statusId: true,
      clientNameOverride: true,
      designStartedAt: true,
      designStartedByName: true,
      client: { select: { first_name: true, last_name: true } },
      branch: BRANCH_BADGE_SELECT,
      status: { select: { id: true, name: true } },
      // Líneas con su desglose de tallas: Tareas/TV muestran el resumen
      // ("General: 5 S · 2 M — 7 pzas") para que producción sepa qué cortar.
      orderProducts: {
        select: { customName: true, quantity: true, sizes: true },
      },
    } satisfies Prisma.OrderSelect;

    const assigneeSelect = {
      select: { id: true, firstName: true, lastName: true, username: true },
    } satisfies Prisma.UserDefaultArgs;

    const items: MyTaskItem[] = [];

    if (designs) {
      const designStatusIds = await Promise.all([
        this.statusIds.idFor(STATUS_NAME_EN_DISENO),
        this.statusIds.idFor(STATUS_NAME_CAMBIOS_SOLICITADOS),
      ]);
      const designOrders = await this.prisma.order.findMany({
        where: {
          requiresDesign: true,
          area: Role.DISENO,
          statusId: { in: designStatusIds },
        },
        select: {
          ...orderSelect,
          assignedUserId: true,
          assignedUser: assigneeSelect,
        },
      });
      for (const order of designOrders) {
        if (!visibleTo(order.assignedUserId)) continue;
        const { assignedUserId, assignedUser, ...rest } = order;
        items.push({
          key: `design-${order.id}`,
          kind: 'design',
          area: Role.DISENO,
          taskId: null,
          status: order.status.name,
          mine: isMine(assignedUserId),
          assignee: isFree(assignedUserId) ? null : assignedUser,
          startedAt: order.designStartedAt,
          order: rest,
        });
      }
    }

    if (productionAreas.length > 0) {
      const closedStatusIds = await this.finalStatusIds();
      const tasks = await this.prisma.orderAreaTask.findMany({
        where: {
          area: { in: productionAreas },
          status: { not: AreaTaskStatus.terminado },
          order: {
            statusId: { notIn: closedStatusIds },
            // Planificadas mientras el pedido sigue en Diseño: todavía no.
            NOT: { area: Role.DISENO },
          },
        },
        select: {
          id: true,
          area: true,
          status: true,
          prepStage: true,
          sampleTests: {
            orderBy: { round: 'desc' as const },
            take: 1,
            select: {
              round: true,
              result: true,
              sentNotes: true,
              resultNotes: true,
            },
          },
          assignedUserId: true,
          startedAt: true,
          assignedUser: assigneeSelect,
          supply: TASK_SUPPLY_SELECT,
          order: { select: orderSelect },
        },
      });
      for (const task of tasks) {
        if (!visibleTo(task.assignedUserId)) continue;
        items.push({
          key: `task-${task.id}`,
          kind: 'production',
          area: task.area,
          taskId: task.id,
          status: task.status,
          prepStage: task.prepStage,
          lastTest: task.sampleTests?.[0] ?? null,
          mine: isMine(task.assignedUserId),
          assignee: isFree(task.assignedUserId) ? null : task.assignedUser,
          startedAt: task.startedAt,
          supply: serializeSupply(task.supply),
          order: task.order,
        });
      }
    }

    return items;
  }

  /**
   * GET /orders/:id/area-supplies — hoja de materiales por área: origen,
   * líneas con su estado (apartado / descontado), existencia y apartado
   * total de cada artículo, y los movimientos de inventario que generó.
   *
   * Visibilidad: las cuentas de sucursal no la ven (403); un usuario de área
   * sólo recibe las hojas (y existencias y movimientos) de SUS áreas;
   * Recepción/admin ven todas.
   *
   * Una línea "nuestra" ligada a inventario de una tarea ya `terminado` que
   * sigue sin descontar trae `pendingDiscount: true` y `shortfall` (cuánto
   * falta de existencia; 0 si ya hay y sólo falta reintentar). Cada área
   * trae `pendingDiscount` si alguna de sus líneas está así.
   */
  async getSupplySheet(orderId: number, requestingUser?: RequestingUser) {
    let visibleAreas: string[] | null = null;
    if (requestingUser) {
      if (isBranchOnlyUser(requestingUser.roles)) {
        throw new HttpException(
          'Sin acceso a los insumos del pedido',
          HttpStatus.FORBIDDEN,
        );
      }
      if (!isFullVisibilityRole(requestingUser.roles)) {
        visibleAreas = operationalRolesOf(requestingUser.roles);
      }
    }
    const tasks = await this.prisma.orderAreaTask.findMany({
      where: {
        orderId,
        ...(visibleAreas !== null && { area: { in: visibleAreas } }),
      },
      select: {
        id: true,
        area: true,
        status: true,
        supply: TASK_SUPPLY_SELECT,
      },
      orderBy: { createdAt: 'asc' },
    });
    const itemIds = [
      ...new Set(
        tasks.flatMap(
          (t) =>
            t.supply?.lines
              .map((l) => l.inventoryItemId)
              .filter((id): id is number => id !== null) ?? [],
        ),
      ),
    ];
    const taskIds = tasks.map((t) => t.id);
    const [items, reserved, movements] = await Promise.all([
      itemIds.length
        ? this.prisma.inventoryItem.findMany({
            where: { id: { in: itemIds } },
            select: { id: true, quantity: true },
          })
        : Promise.resolve([]),
      reservedByItem(this.prisma, itemIds),
      taskIds.length
        ? this.prisma.inventoryMovement.findMany({
            where: { orderId, areaTaskId: { in: taskIds } },
            select: {
              id: true,
              itemId: true,
              type: true,
              delta: true,
              balanceAfter: true,
              note: true,
              areaTaskId: true,
              createdAt: true,
              item: { select: { id: true, name: true, unit: true } },
              createdBy: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          })
        : Promise.resolve([]),
    ]);
    const stock = new Map(items.map((i) => [i.id, Number(i.quantity)]));
    return {
      areas: tasks.map((task) => {
        const supply = serializeSupply(task.supply);
        const finished = task.status === AreaTaskStatus.terminado;
        let areaPending = false;
        const result = {
          taskId: task.id,
          area: task.area,
          status: task.status,
          supply:
            supply &&
            ({
              ...supply,
              lines: supply.lines.map((line) => {
                const id = line.inventoryItemId;
                if (id === null) return { ...line, stock: null };
                const quantity = stock.get(id) ?? 0;
                const held = reserved.get(id) ?? 0;
                const pendingDiscount =
                  finished &&
                  !line.discountedAt &&
                  supply.source === SupplySource.nosotros;
                if (pendingDiscount) areaPending = true;
                return {
                  ...line,
                  state: line.discountedAt ? 'descontado' : 'apartado',
                  pendingDiscount,
                  shortfall: pendingDiscount
                    ? Math.max(0, Number(line.quantity) - quantity)
                    : 0,
                  stock: {
                    quantity,
                    reserved: held,
                    available: quantity - held,
                  },
                };
              }),
            } as typeof supply),
          pendingDiscount: false,
        };
        result.pendingDiscount = areaPending;
        return result;
      }),
      movements: movements.map((m) => ({
        ...m,
        delta: Number(m.delta),
        balanceAfter: Number(m.balanceAfter),
      })),
    };
  }

  /**
   * PUT /orders/:id/area-supplies — corrige la hoja de materiales después de
   * autorizar (Recepción/admin). Devuelve la hoja y los avisos de stock.
   * 409 si la tarea ya está terminada y la hoja cambiaría.
   */
  async saveSupplies(
    orderId: number,
    supplies: AreaSupplyDto[],
    requestingUser: RequestingUser,
  ) {
    const warnings = await this.prisma.$transaction(
      (tx) => saveSuppliesTx(tx, orderId, supplies, requestingUser.userId),
      SUPPLY_TX_OPTIONS,
    );
    return {
      ...(await this.getSupplySheet(orderId, requestingUser)),
      warnings,
    };
  }

  /**
   * POST /orders/:id/area-supplies/:area/discount-pending — reintenta el
   * descuento de las líneas que quedaron sin descontar al terminar la tarea
   * por falta de existencia (Recepción/admin, tras dar entrada al inventario).
   * Idempotente: sólo mueve las líneas que sigan sin descontar y alcancen.
   */
  async discountPending(
    orderId: number,
    area: string,
    requestingUser: RequestingUser,
  ) {
    const task = await this.prisma.orderAreaTask.findFirst({
      where: { orderId, area },
      select: { id: true, orderId: true, area: true },
    });
    if (!task) {
      throw new HttpException(
        `El pedido no tiene tarea de ${area}`,
        HttpStatus.NOT_FOUND,
      );
    }
    const supplyResult = await this.prisma.$transaction(
      (tx) => discountPendingSupplyTx(tx, task, requestingUser.userId),
      SUPPLY_TX_OPTIONS,
    );
    await this.notifySupplyResult(task, supplyResult);
    return this.getSupplySheet(orderId, requestingUser);
  }

  /**
   * Avisos tras mover inventario por la hoja de materiales (fuera de la
   * transacción y sin fallar la operación si el aviso falla): a Recepción y
   * admin, líneas que no se pudieron descontar y artículos que cruzaron su
   * punto de reorden.
   */
  private async notifySupplyResult(
    task: { orderId: number; area: string },
    result: SupplyInventoryResult,
  ) {
    if (result.pending.length === 0 && result.lowStock.length === 0) return;
    try {
      const audiences = await Promise.all(
        [Role.RECEPCION, Role.ADMIN].map((role) =>
          this.notificationService.userIdsForArea(role),
        ),
      );
      const recipients = [...new Set(audiences.flat())];
      for (const line of result.pending) {
        await this.notificationService.createNotificationForUsers(recipients, {
          type: 'inventory_pending_discount',
          title: `Descuento pendiente: ${line.itemName}`,
          body: `No se descontó ${line.itemName} del pedido #${task.orderId}: faltan ${line.missing} ${line.unit}`,
          orderId: task.orderId,
        });
      }
      for (const item of result.lowStock) {
        await this.notificationService.createNotificationForUsers(recipients, {
          type: 'inventory_low_stock',
          title:
            item.after <= 0
              ? `Agotado: ${item.name}`
              : `Stock bajo: ${item.name}`,
          body: `Quedan ${item.after} ${item.unit}${
            item.minStock !== null ? ` · mínimo ${item.minStock}` : ''
          }`,
        });
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar el descuento de insumos: ${(error as Error)?.message}`,
      );
    }
  }

  /** Tareas de un pedido, en orden de creación. */
  async findByOrder(orderId: number, requestingUser?: RequestingUser) {
    const tasks = await this.prisma.orderAreaTask.findMany({
      where: { orderId },
      select: this.taskSelect(),
      orderBy: { createdAt: 'asc' },
    });
    return this.stripSupplyForBranch(tasks, requestingUser);
  }

  /**
   * Cambia el estado de una tarea y sincroniza el pedido:
   * - al pasar a `en_proceso` marca `startedAt`;
   * - al pasar a `terminado` marca `completedAt` y, si TODAS las áreas del
   *   pedido terminaron, lo deja "listo para entregar".
   */
  async updateStatus(
    taskId: number,
    status: AreaTaskStatus,
    requestingUser: RequestingUser,
    orderId?: number,
  ) {
    const task = await this.prisma.orderAreaTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        orderId: true,
        area: true,
        status: true,
        prepStage: true,
        assignedUserId: true,
      },
    });
    if (!task || !this.belongsToOrder(task.orderId, orderId)) {
      throw new HttpException('La tarea no existe', HttpStatus.NOT_FOUND);
    }
    this.assertCanWorkArea(task.area, requestingUser);
    this.assertValidTransition(task.status, status);
    this.assertNotInPrepStage(task.prepStage, status);

    // "Empezar" es "tomar" (WORKFLOW.md §3, paso 7): si la tarea está sin
    // asignar o todavía en la cuenta compartida del área, al pasarla a
    // en_proceso queda a nombre de quien la arrancó.
    // ...pero SOLO si quien la mueve pertenece al área: Recepción/admin
    // pueden mover el estado de cualquier tarea, y si se la quedaran el área
    // perdería su bandeja (mismo criterio que `assign`).
    const shouldClaim =
      status === AreaTaskStatus.en_proceso &&
      requestingUser.roles.includes(task.area) &&
      (await this.isUnclaimed(task.area, task.assignedUserId));

    const now = new Date();
    // Cambio de estado + descuento/devolución de insumos "nuestros" en UNA
    // transacción. Primero se toma el candado de la fila de la tarea y se
    // vuelve a leer el estado: el de arriba pudo cambiar mientras tanto (dos
    // "terminado" simultáneos), y sólo el primero debe mover el inventario.
    // Si no alcanza el stock de alguna línea la tarea SÍ queda terminada: esa
    // línea queda apartada (descuento pendiente) y se avisa a Recepción.
    const { updated, supplyResult, raced } = await this.prisma.$transaction(
      async (tx) => {
        const current = await lockTaskStatusTx(tx, taskId);
        if (current === null) {
          throw new HttpException('La tarea no existe', HttpStatus.NOT_FOUND);
        }
        this.assertValidTransition(current, status);
        if (current === status && task.status !== status) {
          // Otra petición simultánea ya hizo este mismo cambio mientras
          // esperábamos el candado: no se repite nada (ni inventario ni avisos).
          return {
            updated: await tx.orderAreaTask.findUniqueOrThrow({
              where: { id: taskId },
              select: this.taskSelect(),
            }),
            supplyResult: {
              pending: [],
              lowStock: [],
            } as SupplyInventoryResult,
            raced: true,
          };
        }
        const supplyResult = await applySupplyInventoryForStatusTx(
          tx,
          task,
          current,
          status,
          requestingUser.userId,
        );
        const updated = await tx.orderAreaTask.update({
          where: { id: taskId },
          data: {
            status,
            ...(shouldClaim && { assignedUserId: requestingUser.userId }),
            ...(status === AreaTaskStatus.en_proceso && { startedAt: now }),
            ...(status === AreaTaskStatus.terminado && { completedAt: now }),
          },
          select: this.taskSelect(),
        });
        return { updated, supplyResult, raced: false };
      },
      SUPPLY_TX_OPTIONS,
    );
    if (raced) return this.stripSupplyForBranch(updated, requestingUser);
    await this.notifySupplyResult(task, supplyResult);

    await this.syncOrderStatusFromTasks(task.orderId, requestingUser.userId);
    if (status === AreaTaskStatus.terminado) {
      await this.notifyReceptionOfProgress(
        task.orderId,
        task.area,
        requestingUser.userId,
      );
    }
    return this.stripSupplyForBranch(updated, requestingUser);
  }

  /**
   * Una tarea de Bordado que sigue en digitalización o en pruebas no puede
   * empezar ni terminar: antes necesita la prueba aprobada (WORKFLOW.md §3.1).
   * Quedarse en `pendiente` (o repetir el mismo estado) sí es válido.
   */
  private assertNotInPrepStage(
    prepStage: EmbroideryPrepStage | null,
    to: AreaTaskStatus,
  ) {
    if (!prepStage || to === AreaTaskStatus.pendiente) return;
    throw new BadRequestException(
      prepStage === EmbroideryPrepStage.digitalizado
        ? 'Bordado todavía está en digitalización: primero hay que mandarlo a pruebas y que la prueba se apruebe.'
        : 'La prueba de bordado sigue pendiente: hay que aprobarla antes de empezar la producción.',
    );
  }

  /** Carga la tarea para las acciones de pruebas y valida pedido, área y permiso. */
  private async loadBordadoTask(
    taskId: number,
    requestingUser: RequestingUser,
    orderId?: number,
  ) {
    const task = await this.prisma.orderAreaTask.findUnique({
      where: { id: taskId },
      select: { id: true, orderId: true, area: true, prepStage: true },
    });
    if (!task || !this.belongsToOrder(task.orderId, orderId)) {
      throw new HttpException('La tarea no existe', HttpStatus.NOT_FOUND);
    }
    if (task.area !== PREP_STAGE_AREA) {
      throw new BadRequestException(
        'Sólo Bordado pasa por digitalización y pruebas',
      );
    }
    this.assertCanWorkArea(task.area, requestingUser);
    return task;
  }

  /**
   * Manda la digitalización a pruebas: abre una ronda nueva en el registro y
   * la tarea pasa de `digitalizado` a `en_pruebas`. Se usa tanto la primera vez
   * como después de corregir una prueba rechazada.
   */
  async sendToTest(
    taskId: number,
    notes: string | undefined,
    requestingUser: RequestingUser,
    orderId?: number,
    photo?: OrderFileDto,
  ) {
    const task = await this.loadBordadoTask(taskId, requestingUser, orderId);
    if (task.prepStage !== EmbroideryPrepStage.digitalizado) {
      throw new BadRequestException(
        task.prepStage === EmbroideryPrepStage.en_pruebas
          ? 'La tarea ya está en pruebas'
          : 'La tarea ya pasó las pruebas',
      );
    }
    const trimmed = notes?.trim() || null;
    if (photo) {
      await assertBase64FileValid(photo, {
        maxBytes: SAMPLE_PHOTO_MAX_BYTES,
        allowedMimeTypes: SAMPLE_PHOTO_MIME_TYPES,
        sizeErrorMessage: 'La foto no puede superar 5MB',
        typeErrorMessage: 'La foto debe ser una imagen PNG o JPEG',
      });
    }
    const photoBlob: StoredBlob | null = photo
      ? await this.storage.saveBase64(
          STORAGE_FOLDERS.sampleTestPhoto,
          photo.data,
          photo.mimeType,
        )
      : null;

    let updated;
    try {
      updated = await this.openSampleTestRound(
        taskId,
        trimmed,
        requestingUser.userId,
        photo,
        photoBlob,
      );
    } catch (error) {
      // La ronda no se abrió: el objeto recién subido quedaría huérfano.
      await this.storage.deleteQuietly([photoBlob?.key]);
      throw error;
    }

    const round = updated.sampleTests.at(-1)?.round;
    await this.recordSampleAudit('embroidery_test_sent', task, requestingUser, {
      round,
      notes: trimmed,
      hasPhoto: !!photo,
    });
    await this.notifyReceptionOfSampleSent(
      task.orderId,
      round ?? 1,
      !!photo,
      requestingUser.userId,
    );
    return this.stripSupplyForBranch(updated, requestingUser);
  }

  private async openSampleTestRound(
    taskId: number,
    trimmed: string | null,
    userId: number,
    photo: OrderFileDto | undefined,
    photoBlob: StoredBlob | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Condicional sobre la etapa: dos clics simultáneos no abren dos rondas.
      const { count } = await tx.orderAreaTask.updateMany({
        where: { id: taskId, prepStage: EmbroideryPrepStage.digitalizado },
        data: { prepStage: EmbroideryPrepStage.en_pruebas },
      });
      if (count !== 1) {
        throw new BadRequestException('La tarea ya está en pruebas');
      }
      const last = await tx.areaTaskSampleTest.aggregate({
        where: { areaTaskId: taskId },
        _max: { round: true },
      });
      await tx.areaTaskSampleTest.create({
        data: {
          areaTaskId: taskId,
          round: (last._max.round ?? 0) + 1,
          sentByUserId: userId,
          sentNotes: trimmed,
          ...(photo &&
            photoBlob && {
              photoData: photoBlob.data,
              photoKey: photoBlob.key,
              photoName: photo.filename,
              photoMime: photo.mimeType,
            }),
        },
      });
      return tx.orderAreaTask.findUniqueOrThrow({
        where: { id: taskId },
        select: this.taskSelect(),
      });
    });
  }

  /** Aviso a Recepción: hay una prueba esperando revisión y autorización. */
  private async notifyReceptionOfSampleSent(
    orderId: number,
    round: number,
    hasPhoto: boolean,
    actorId: number,
  ) {
    try {
      const receptionOwnerId = await this.orderReceptionOwnerId(orderId);
      // Nadie recibe el aviso de su propia acción.
      if (receptionOwnerId === null || receptionOwnerId === actorId) return;
      await this.notificationService.createNotification({
        userId: receptionOwnerId,
        type: 'embroidery_test_sent',
        title: 'Prueba de bordado por revisar',
        body: `Pedido #${orderId}: Bordado mandó la prueba ${round}${hasPhoto ? ' con foto' : ''} a revisión y autorización`,
        orderId,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar la prueba a Recepción: ${(error as Error)?.message}`,
      );
    }
  }

  /** Foto de una prueba de bordado, como data URL. 404 si no tiene. */
  async getSampleTestPhoto(taskId: number, testId: number, orderId?: number) {
    const test = await this.prisma.areaTaskSampleTest.findUnique({
      where: { id: testId },
      select: {
        areaTaskId: true,
        photoData: true,
        photoKey: true,
        photoName: true,
        photoMime: true,
        areaTask: { select: { orderId: true } },
      },
    });
    if (
      !test ||
      test.areaTaskId !== taskId ||
      !this.belongsToOrder(test.areaTask.orderId, orderId) ||
      !test.photoName ||
      !test.photoMime
    ) {
      throw new HttpException('La prueba no tiene foto', HttpStatus.NOT_FOUND);
    }
    return {
      filename: test.photoName,
      mimeType: test.photoMime,
      dataUrl: await this.storage.toDataUrl(test.photoMime, {
        data: test.photoData,
        key: test.photoKey,
      }),
    };
  }

  /**
   * Registra el resultado de la prueba abierta.
   * - `aprobada`: la tarea queda lista para producción (`prepStage = null`,
   *   sigue `pendiente` hasta que el área la empiece).
   * - `rechazada`: vuelve a `digitalizado` para corregir; las observaciones son
   *   obligatorias para que quien digitaliza sepa qué corregir.
   */
  async decideTest(
    taskId: number,
    result: SampleTestResult,
    notes: string | undefined,
    requestingUser: RequestingUser,
    orderId?: number,
  ) {
    const task = await this.loadBordadoTask(taskId, requestingUser, orderId);
    if (task.prepStage !== EmbroideryPrepStage.en_pruebas) {
      throw new BadRequestException('La tarea no está en pruebas');
    }
    const trimmed = notes?.trim() || null;
    if (result === SampleTestResult.rechazada && !trimmed) {
      throw new BadRequestException(
        'Explica qué hay que corregir al rechazar la prueba',
      );
    }

    const { updated, round } = await this.prisma.$transaction(async (tx) => {
      // Condicional sobre la etapa: dos resultados simultáneos no se pisan.
      const { count } = await tx.orderAreaTask.updateMany({
        where: { id: taskId, prepStage: EmbroideryPrepStage.en_pruebas },
        data: {
          prepStage:
            result === SampleTestResult.aprobada
              ? null
              : EmbroideryPrepStage.digitalizado,
        },
      });
      if (count !== 1) {
        throw new BadRequestException('La tarea no está en pruebas');
      }
      const open = await tx.areaTaskSampleTest.findFirst({
        where: { areaTaskId: taskId, result: null },
        orderBy: { round: 'desc' },
        select: { id: true, round: true },
      });
      if (!open) {
        throw new BadRequestException('No hay una prueba abierta');
      }
      await tx.areaTaskSampleTest.update({
        where: { id: open.id },
        data: {
          result,
          resultNotes: trimmed,
          decidedAt: new Date(),
          decidedByUserId: requestingUser.userId,
        },
      });
      return {
        round: open.round,
        updated: await tx.orderAreaTask.findUniqueOrThrow({
          where: { id: taskId },
          select: this.taskSelect(),
        }),
      };
    });

    await this.recordSampleAudit(
      result === SampleTestResult.aprobada
        ? 'embroidery_test_approved'
        : 'embroidery_test_rejected',
      task,
      requestingUser,
      { round, notes: trimmed },
    );
    await this.notifySampleTestResult(
      task.orderId,
      result,
      round,
      trimmed,
      requestingUser.userId,
    );
    return this.stripSupplyForBranch(updated, requestingUser);
  }

  /**
   * Avisos del resultado de una prueba de bordado (WORKFLOW.md §3.1):
   * - rechazada: a Bordado, que tiene que corregir la digitalización;
   * - aprobada: a Bordado (ya puede producir) y a la recepcionista que atiende
   *   el pedido.
   * Nadie recibe el aviso de su propia acción. Un fallo al avisar no revierte
   * el resultado, que ya quedó guardado.
   */
  private async notifySampleTestResult(
    orderId: number,
    result: SampleTestResult,
    round: number,
    notes: string | null,
    actorId: number,
  ) {
    try {
      const approved = result === SampleTestResult.aprobada;
      const areaUserIds = (
        await this.notificationService.userIdsForArea(PREP_STAGE_AREA)
      ).filter((id) => id !== actorId);
      await this.notificationService.createNotificationForUsers(areaUserIds, {
        type: approved
          ? 'embroidery_test_approved'
          : 'embroidery_test_rejected',
        title: approved
          ? 'Prueba de bordado aprobada'
          : 'Prueba de bordado rechazada',
        body: approved
          ? `Pedido #${orderId}: la prueba ${round} se aprobó, ya se puede producir`
          : `Pedido #${orderId}: la prueba ${round} se rechazó${notes ? ` — ${notes}` : ''}`,
        orderId,
      });
      if (!approved) return;
      const receptionOwnerId = await this.orderReceptionOwnerId(orderId);
      if (receptionOwnerId === null || receptionOwnerId === actorId) return;
      await this.notificationService.createNotification({
        userId: receptionOwnerId,
        type: 'embroidery_test_approved',
        title: 'Prueba de bordado aprobada',
        body: `Pedido #${orderId}: la prueba ${round} se aprobó, Bordado pasa a producción`,
        orderId,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar el resultado de la prueba: ${(error as Error)?.message}`,
      );
    }
  }

  private async recordSampleAudit(
    action: string,
    task: { id: number; orderId: number },
    requestingUser: RequestingUser,
    metadata: Record<string, unknown>,
  ) {
    await this.auditLog.record({
      actorUserId: requestingUser.userId,
      action,
      entityType: 'order',
      entityId: task.orderId,
      metadata: { areaTaskId: task.id, ...metadata },
    });
  }

  /**
   * Reasigna una tarea. Recepción/admin pueden asignar a cualquiera del área;
   * un empleado del área puede tomársela para sí mismo (WORKFLOW.md §5).
   */
  async assign(
    taskId: number,
    assignedUserId: number | null,
    requestingUser: RequestingUser,
    orderId?: number,
  ) {
    const task = await this.prisma.orderAreaTask.findUnique({
      where: { id: taskId },
      select: { id: true, area: true, orderId: true },
    });
    if (!task || !this.belongsToOrder(task.orderId, orderId)) {
      throw new HttpException('La tarea no existe', HttpStatus.NOT_FOUND);
    }

    const isManager = requestingUser.roles.some((r) =>
      TASK_MANAGER_ROLES.includes(r),
    );
    const isSelfAssign = assignedUserId === requestingUser.userId;
    if (!isManager && !isSelfAssign) {
      throw new HttpException(
        'Sólo Recepción o un administrador pueden asignar la tarea a otra persona',
        HttpStatus.FORBIDDEN,
      );
    }
    this.assertCanWorkArea(task.area, requestingUser);

    if (assignedUserId !== null) {
      const user = await this.prisma.user.findUnique({
        where: { id: assignedUserId },
        select: { roles: { select: { name: true } } },
      });
      if (!user) {
        throw new HttpException(
          'El usuario asignado no existe',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!user.roles.some((r) => r.name === task.area)) {
        throw new HttpException(
          `El usuario asignado no pertenece al área ${task.area}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const updated = await this.prisma.orderAreaTask.update({
      where: { id: taskId },
      data: { assignedUserId },
      select: this.taskSelect(),
    });
    return this.stripSupplyForBranch(updated, requestingUser);
  }

  /** Quita un área del pedido (sólo Recepción/admin). */
  async remove(
    taskId: number,
    requestingUser: RequestingUser,
    orderId?: number,
  ) {
    const isManager = requestingUser.roles.some((r) =>
      TASK_MANAGER_ROLES.includes(r),
    );
    if (!isManager) {
      throw new HttpException(
        'Sólo Recepción o un administrador pueden quitar un área del pedido',
        HttpStatus.FORBIDDEN,
      );
    }
    const task = await this.prisma.orderAreaTask.findUnique({
      where: { id: taskId },
      select: {
        orderId: true,
        sampleTests: { select: { photoKey: true } },
      },
    });
    if (!task || !this.belongsToOrder(task.orderId, orderId)) {
      throw new HttpException('La tarea no existe', HttpStatus.NOT_FOUND);
    }
    await this.prisma.orderAreaTask.delete({ where: { id: taskId } });
    // Las pruebas se borran en cascada; sus fotos en el bucket, no.
    await this.storage.deleteQuietly(
      (task.sampleTests ?? []).map((test) => test.photoKey),
    );
    await this.syncOrderStatusFromTasks(task.orderId, requestingUser.userId);
    return { deleted: true };
  }

  /**
   * La tarea debe ser del pedido de la URL (`/orders/:id/area-tasks/:taskId`):
   * si no, se responde 404 igual que si no existiera, para no revelar tareas
   * de otros pedidos. Sin `orderId` (llamadas internas) no se compara.
   */
  private belongsToOrder(taskOrderId: number, orderId?: number) {
    return orderId === undefined || taskOrderId === orderId;
  }

  /**
   * Un usuario sólo puede mover tareas de sus propias áreas; Recepción y admin
   * pueden con todas.
   */
  private assertCanWorkArea(area: string, requestingUser: RequestingUser) {
    const isManager = requestingUser.roles.some((r) =>
      TASK_MANAGER_ROLES.includes(r),
    );
    if (isManager) return;
    if (!requestingUser.roles.includes(area)) {
      throw new HttpException(
        `Sin permiso para trabajar tareas del área ${area}`,
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /** Rechaza saltos de estado que no existen en el ciclo de la tarea. */
  private assertValidTransition(from: AreaTaskStatus, to: AreaTaskStatus) {
    if (from === to) return;
    if (!ALLOWED_TASK_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(
        `No se puede pasar la tarea de "${from}" a "${to}"`,
      );
    }
  }

  /**
   * Si la tarea todavía no la tomó nadie: sin responsable, o a nombre de la
   * cuenta compartida del área (que representa "cualquiera del área").
   */
  private async isUnclaimed(
    area: string,
    assignedUserId: number | null,
  ): Promise<boolean> {
    if (assignedUserId === null) return true;
    const sharedId = await this.sharedAccountIdForArea(area);
    return sharedId !== null && sharedId === assignedUserId;
  }

  /**
   * Deriva el estado global del pedido de sus tareas: si todas terminaron pasa
   * a "listo para entregar" (terminado). NUNCA lo marca como entregado: eso lo
   * confirma Recepción.
   *
   * Al revés también: si un área retrocede de `terminado` y el pedido ya
   * estaba "listo para entregar", el pedido vuelve a "autorizado". Lo mismo si
   * se quitó la última área del pedido: sin tareas no hay nada terminado.
   *
   * No toca pedidos ya entregados/cancelados.
   */
  private async syncOrderStatusFromTasks(orderId: number, actorId?: number) {
    const tasks = await this.prisma.orderAreaTask.findMany({
      where: { orderId },
      select: { status: true },
    });

    const readyId = await this.statusIds.idFor(STATUS_NAME_TERMINADO);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { statusId: true },
    });
    if (!order) return;
    // Estados finales, que no se pisan.
    const finalIds = await this.finalStatusIds();
    if (finalIds.includes(order.statusId)) return;

    // Sin tareas no queda nada "terminado": si el pedido había quedado listo
    // para entregar (se borró la última área), vuelve a "autorizado".
    const allDone =
      tasks.length > 0 &&
      tasks.every((t) => t.status === AreaTaskStatus.terminado);

    if (!allDone) {
      // Un área retrocedió (o ya no hay áreas): el pedido deja de estar listo.
      if (order.statusId !== readyId) return;
      const autorizadoId = await this.statusIds.idFor(STATUS_NAME_AUTORIZADO);
      await this.applyOrderStatus(orderId, order.statusId, autorizadoId);
      return;
    }

    if (order.statusId === readyId) return;

    // Sólo se notifica si ESTA llamada fue la que hizo la transición: dos
    // áreas terminando a la vez no pueden generar dos avisos.
    const applied = await this.applyOrderStatus(
      orderId,
      order.statusId,
      readyId,
    );
    if (!applied) return;

    await this.notifyReceptionOrderReady(orderId, actorId);
  }

  /**
   * Cambia el estado global del pedido dejando rastro en el historial.
   *
   * El update es CONDICIONAL y va dentro de la transacción
   * (`updateMany` con el estado previo en el `where`): si otra área ya movió
   * el pedido entre el read y el write, `count` es 0, no se escribe historial
   * y el llamador sabe que la transición no fue suya. Evita dos
   * `OrderHistory` y dos notificaciones de la misma transición.
   */
  private async applyOrderStatus(
    orderId: number,
    previousStatusId: number,
    newStatusId: number,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: orderId, statusId: previousStatusId },
        data: { statusId: newStatusId },
      });
      if (count !== 1) return false;
      await tx.orderHistory.create({
        data: { orderId, previousStatusId, newStatusId },
      });
      return true;
    });
  }

  /** Ids de los estados finales, que este servicio nunca pisa. */
  private async finalStatusIds(): Promise<number[]> {
    return Promise.all([
      this.statusIds.idFor(STATUS_NAME_ENTREGADO),
      this.statusIds.idFor(STATUS_NAME_CANCELADO),
    ]);
  }

  /**
   * Destinatario EFECTIVO de los avisos que van "a Recepción" en este pedido:
   * quien lo ATIENDE hoy (`attendedByUserId`) o, si nadie lo tomó, quien lo
   * creó (`userId`). Ver `OrderService.receptionOwnerIdOf` y WORKFLOW.md §2.
   */
  private async orderReceptionOwnerId(orderId: number): Promise<number | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true, attendedByUserId: true },
    });
    if (!order) return null;
    return order.attendedByUserId ?? order.userId;
  }

  /** Recepción sigue el avance global: aviso por cada etapa completada. */
  private async notifyReceptionOfProgress(
    orderId: number,
    area: string,
    actorId?: number,
  ) {
    // Va SÓLO a UNA recepcionista, no a todo el área: la que le está
    // siguiendo el rastro a ese cliente, o sea quien atiende el pedido
    // (WORKFLOW.md §2).
    const receptionOwnerId = await this.orderReceptionOwnerId(orderId);
    // Nadie recibe el aviso de su propia acción.
    if (receptionOwnerId === null || receptionOwnerId === actorId) return;
    await this.notificationService.createNotification({
      userId: receptionOwnerId,
      type: 'area_task_completed',
      title: `${area} terminó su parte`,
      body: `Pedido #${orderId}: el área ${area} completó su tarea`,
      orderId,
    });
  }

  private async notifyReceptionOrderReady(orderId: number, actorId?: number) {
    const receptionOwnerId = await this.orderReceptionOwnerId(orderId);
    // Nadie recibe el aviso de su propia acción.
    if (receptionOwnerId === null || receptionOwnerId === actorId) return;
    await this.notificationService.createNotification({
      userId: receptionOwnerId,
      type: 'order_ready',
      title: 'Pedido listo para entregar',
      body: `Pedido #${orderId}: todas las áreas terminaron, falta confirmar la entrega`,
      orderId,
    });
  }
}
