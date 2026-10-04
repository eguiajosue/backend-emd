import { Injectable } from '@nestjs/common';
import { AreaTaskStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ClientInsightService,
  DueClient,
} from '../client-insight/client-insight.service';
import { PRODUCTION_AREAS } from '../order/dto/create-order.dto';
import { isFullVisibilityRole } from '../order/role-stage-mapping';
import {
  STATUS_NAME_CAMBIOS_SOLICITADOS,
  STATUS_NAME_CANCELADO,
  STATUS_NAME_EN_DISENO,
  STATUS_NAME_ENTREGADO,
  STATUS_NAME_ESPERANDO_AUTORIZACION,
  STATUS_NAME_TERMINADO,
  StatusIdResolver,
} from '../order/status-id-resolver';
import { stockStatusOf } from '../inventory/inventory.service';
import type { RequestingUser } from '../order/order.service';
import {
  AreaHealth,
  AttentionInput,
  AttentionReason,
  areaHealth,
  attentionFor,
  compareAttention,
  deadlineTone,
} from './dashboard.rules';

const DAY_MS = 86_400_000;
const DESIGN_AREA = 'diseno';
const ATTENTION_LIMIT = 8;
const LIST_LIMIT = 5;

/* ---------------------------------- Tipos --------------------------------- */

export interface OrderRef {
  id: number;
  clientName: string;
  description: string;
  products: Array<{ customName: string; quantity: number }>;
  deliveryDate: string | null;
  creationDate: string;
  statusName: string;
}

export interface Person {
  id: number;
  name: string;
}

export interface AreaLoad {
  area: string;
  /** Sin empezar (Diseño: nuevos que nadie abrió). */
  pending: number;
  inProgress: number;
  doneToday: number;
  overdue: number;
  atRisk: number;
  /** Desde cuándo espera el trabajo sin empezar más viejo. */
  oldestWaitingSince: string | null;
  /** Producción: tareas planificadas de pedidos que todavía están en Diseño. */
  upcoming: number;
  /** Sólo Diseño. */
  changesRequested?: number;
  waitingClient?: number;
  /** Quiénes tienen algo en proceso ahora (sin las cuentas compartidas). */
  people: string[];
  health: AreaHealth;
}

export interface AttentionItem extends OrderRef {
  reason: AttentionReason;
  since: string | null;
  area: string | null;
}

export interface LowStockItem {
  id: number;
  name: string;
  area: string;
  unit: string;
  quantity: number;
  minStock: number | null;
  stockStatus: 'low' | 'out';
}

export interface ReceptionDashboard {
  generatedAt: string;
  dayStart: string;
  totals: {
    active: number;
    inDesign: number;
    waitingClient: number;
    inProduction: number;
    ready: number;
    noDate: number;
  };
  /** Plazos de los pedidos activos que todavía no están listos. */
  deadlines: {
    overdue: number;
    atRisk: number;
    onTime: number;
    noDate: number;
  };
  today: {
    created: number;
    delivered: number;
    tasksCompleted: number;
    designsApproved: number;
  };
  areas: AreaLoad[];
  attention: AttentionItem[];
  attentionTotal: number;
  /** Últimos 7 días (el último es hoy). */
  throughput: Array<{ day: string; created: number; delivered: number }>;
  clientsDue: DueClient[];
  alerts: {
    lowStock: number;
    outOfStock: number;
    lowStockItems: LowStockItem[];
    purchasesDue: number;
  };
}

export interface ProductionItem extends OrderRef {
  key: string;
  taskId: number;
  area: string;
  status: 'pendiente' | 'en_proceso';
  mine: boolean;
  assignee: Person | null;
  startedAt: string | null;
  /** Desde cuándo el área puede trabajarlo (alta sin diseño o autorización del montaje). */
  availableSince: string;
}

export interface ProductionDashboard {
  generatedAt: string;
  dayStart: string;
  areas: string[];
  counters: {
    overdue: number;
    atRisk: number;
    notStarted: number;
    inProgress: number;
    doneToday: number;
    upcoming: number;
  };
  items: ProductionItem[];
  upcoming: Array<OrderRef & { area: string; designStatus: string }>;
  team: Array<{ name: string; inProgress: number }>;
  events: Array<{
    id: number;
    title: string;
    eventDate: string;
    hasTime: boolean;
    category: string;
    area: string | null;
    clientName: string | null;
    orderId: number | null;
  }>;
}

export interface DesignItem extends OrderRef {
  key: string;
  status: string;
  mine: boolean;
  assignee: Person | null;
  designStartedAt: string | null;
  designStartedByName: string | null;
  /** Rondas de montaje enviadas hasta ahora. */
  round: number;
  lastSentAt: string | null;
  lastFeedbackAt: string | null;
  availableSince: string;
  /** Áreas de producción que lo van a trabajar después. */
  areas: string[];
}

export interface DesignDashboard {
  generatedAt: string;
  dayStart: string;
  counters: {
    changesRequested: number;
    notStarted: number;
    inProgress: number;
    waitingClient: number;
    overdue: number;
    atRisk: number;
    approvedToday: number;
    approvedWeek: number;
  };
  items: DesignItem[];
  waitingClient: DesignItem[];
  team: Array<{
    userId: number | null;
    name: string;
    active: number;
    inProgress: number;
  }>;
  rounds: {
    avgToApproval: number | null;
    approvedLast30: number;
    manyRounds: number;
  };
}

/* --------------------------------- Helpers -------------------------------- */

const ORDER_REF_SELECT = {
  id: true,
  description: true,
  deliveryDate: true,
  creationDate: true,
  clientNameOverride: true,
  client: { select: { first_name: true, last_name: true } },
  orderProducts: { select: { customName: true, quantity: true } },
  status: { select: { name: true } },
} satisfies Prisma.OrderSelect;

const PERSON_SELECT = {
  select: {
    id: true,
    firstName: true,
    lastName: true,
    username: true,
    isSharedAccount: true,
  },
} satisfies Prisma.UserDefaultArgs;

type OrderRefRow = Prisma.OrderGetPayload<{ select: typeof ORDER_REF_SELECT }>;
type PersonRow = {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string;
  isSharedAccount: boolean;
};

function toOrderRef(order: OrderRefRow): OrderRef {
  const clientName = order.client
    ? [order.client.first_name, order.client.last_name]
        .filter(Boolean)
        .join(' ')
    : order.clientNameOverride?.trim() || 'Sin cliente';
  return {
    id: order.id,
    clientName,
    description: order.description,
    products: order.orderProducts.map((p) => ({
      customName: p.customName,
      quantity: p.quantity,
    })),
    deliveryDate: order.deliveryDate?.toISOString() ?? null,
    creationDate: order.creationDate.toISOString(),
    statusName: order.status.name,
  };
}

function personName(
  user: Pick<PersonRow, 'firstName' | 'lastName' | 'username'>,
): string {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username
  );
}

/** Persona real a cargo (las cuentas compartidas del área cuentan como "libre"). */
function realPerson(user: PersonRow | null | undefined): Person | null {
  if (!user || user.isSharedAccount) return null;
  return { id: user.id, name: personName(user) };
}

/** "Hoy" según quien mira; si no lo manda (o es absurdo), medianoche UTC. */
export function resolveDayStart(dayStart: string | undefined, now: Date): Date {
  const utcMidnight = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
  if (!dayStart) return utcMidnight;
  const parsed = new Date(dayStart);
  const age = now.getTime() - parsed.getTime();
  if (Number.isNaN(parsed.getTime()) || age < 0 || age > 2 * DAY_MS)
    return utcMidnight;
  return parsed;
}

const minDate = (dates: Array<Date | null | undefined>): Date | null =>
  dates.reduce<Date | null>(
    (min, d) => (d && (!min || d < min) ? d : min),
    null,
  );

const maxDate = (dates: Array<Date | null | undefined>): Date | null =>
  dates.reduce<Date | null>(
    (max, d) => (d && (!max || d > max) ? d : max),
    null,
  );

/** Saca el campo auxiliar de orden antes de responder. */
function withoutSinceDate(
  item: AttentionItem & { sinceDate: Date | null },
): AttentionItem {
  const copy: AttentionItem & { sinceDate?: Date | null } = { ...item };
  delete copy.sinceDate;
  return copy;
}

/* --------------------------------- Servicio ------------------------------- */

/**
 * Datos de los Inicio por rol: Recepción (control de todas las áreas),
 * Diseño (su bandeja y el estado del circuito) y Producción (los trabajos de
 * sus áreas). Cada pantalla se refresca sola cuando llega `dataChanged` por
 * socket (ver RealtimeService).
 */
@Injectable()
export class DashboardService {
  private readonly statusIds: StatusIdResolver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clientInsights: ClientInsightService,
  ) {
    this.statusIds = new StatusIdResolver(prisma);
  }

  private async ids() {
    const [entregado, cancelado, terminado, enDiseno, esperando, cambios] =
      await Promise.all([
        this.statusIds.idFor(STATUS_NAME_ENTREGADO),
        this.statusIds.idFor(STATUS_NAME_CANCELADO),
        this.statusIds.idFor(STATUS_NAME_TERMINADO),
        this.statusIds.idFor(STATUS_NAME_EN_DISENO),
        this.statusIds.idFor(STATUS_NAME_ESPERANDO_AUTORIZACION),
        this.statusIds.idFor(STATUS_NAME_CAMBIOS_SOLICITADOS),
      ]);
    return {
      entregado,
      cancelado,
      terminado,
      enDiseno,
      esperando,
      cambios,
      closed: [entregado, cancelado],
    };
  }

  private async lowStock(
    areas: readonly string[] | null,
  ): Promise<LowStockItem[]> {
    const items = await this.prisma.inventoryItem.findMany({
      where: areas ? { area: { in: [...areas] } } : undefined,
      select: {
        id: true,
        name: true,
        area: true,
        unit: true,
        quantity: true,
        minStock: true,
      },
    });
    return items
      .map((item) => {
        const quantity = Number(item.quantity);
        const minStock = item.minStock === null ? null : Number(item.minStock);
        return {
          ...item,
          quantity,
          minStock,
          stockStatus: stockStatusOf(quantity, minStock),
        };
      })
      .filter((item): item is LowStockItem => item.stockStatus !== 'ok')
      .sort(
        (a, b) =>
          (a.stockStatus === 'out' ? 0 : 1) -
            (b.stockStatus === 'out' ? 0 : 1) ||
          a.quantity / (a.minStock || 1) - b.quantity / (b.minStock || 1) ||
          a.name.localeCompare(b.name, 'es'),
      );
  }

  /* ------------------------------- Recepción ------------------------------ */

  async reception(
    dayStartParam?: string,
    now = new Date(),
  ): Promise<ReceptionDashboard> {
    const dayStart = resolveDayStart(dayStartParam, now);
    const weekStart = new Date(dayStart.getTime() - 6 * DAY_MS);
    const s = await this.ids();

    const [
      activeOrders,
      tasks,
      doneByArea,
      createdToday,
      createdWeek,
      deliveredWeek,
      approvedToday,
      stock,
      purchasesDue,
      clientsDue,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where: { statusId: { notIn: s.closed } },
        select: {
          ...ORDER_REF_SELECT,
          statusId: true,
          area: true,
          designStartedAt: true,
          assignedUser: PERSON_SELECT,
          areaTasks: { select: { status: true, completedAt: true } },
          designRevisions: {
            orderBy: { round: 'desc' },
            take: 1,
            select: { round: true, sentAt: true, feedbackAt: true },
          },
        },
      }),
      this.prisma.orderAreaTask.findMany({
        where: { order: { statusId: { notIn: s.closed } } },
        select: {
          area: true,
          status: true,
          createdAt: true,
          assignedUser: PERSON_SELECT,
          order: {
            select: { area: true, deliveryDate: true, archivedAt: true },
          },
        },
      }),
      this.prisma.orderAreaTask.groupBy({
        by: ['area'],
        where: { completedAt: { gte: dayStart } },
        _count: { _all: true },
      }),
      this.prisma.order.count({ where: { creationDate: { gte: dayStart } } }),
      this.prisma.order.findMany({
        where: { creationDate: { gte: weekStart } },
        select: { creationDate: true },
      }),
      // "Entregado" sale del historial de estados (no hay columna propia).
      this.prisma.orderHistory.findMany({
        where: { newStatusId: s.entregado, changeDate: { gte: weekStart } },
        select: { orderId: true, changeDate: true },
      }),
      this.prisma.designRevision.count({
        where: { approvedAt: { gte: dayStart } },
      }),
      this.lowStock(null),
      this.prisma.calendarEvent.count({
        where: {
          category: 'compras',
          status: { not: AreaTaskStatus.terminado },
          eventDate: { lte: new Date(now.getTime() + 7 * DAY_MS) },
        },
      }),
      this.clientInsights.dueClients(now),
    ]);

    /* Pedidos activos: fase, plazos y atención */
    const phaseOf = (
      o: (typeof activeOrders)[number],
    ): AttentionInput['phase'] => {
      if (o.statusId === s.terminado) return 'ready';
      if (o.statusId === s.esperando) return 'waiting_client';
      if (o.statusId === s.cambios) return 'changes';
      if (o.statusId === s.enDiseno)
        return o.designStartedAt ? 'design_working' : 'design_new';
      return 'production';
    };
    const totals = {
      active: activeOrders.length,
      inDesign: 0,
      waitingClient: 0,
      inProduction: 0,
      ready: 0,
      noDate: 0,
    };
    const deadlines = { overdue: 0, atRisk: 0, onTime: 0, noDate: 0 };
    const attention: Array<AttentionItem & { sinceDate: Date | null }> = [];
    const design = {
      pending: 0,
      inProgress: 0,
      changesRequested: 0,
      waitingClient: 0,
      overdue: 0,
      atRisk: 0,
      oldest: [] as Date[],
      people: new Set<string>(),
    };

    for (const order of activeOrders) {
      const phase = phaseOf(order);
      const tone = deadlineTone(order.deliveryDate, now);
      const revision = order.designRevisions[0];
      if (phase === 'ready') totals.ready += 1;
      else {
        if (phase === 'waiting_client') totals.waitingClient += 1;
        else if (phase === 'production') totals.inProduction += 1;
        else totals.inDesign += 1;
        if (tone === 'overdue') deadlines.overdue += 1;
        else if (tone === 'at_risk') deadlines.atRisk += 1;
        else if (tone === 'on_time') deadlines.onTime += 1;
        else {
          deadlines.noDate += 1;
          totals.noDate += 1;
        }
      }

      if (
        phase === 'design_new' ||
        phase === 'design_working' ||
        phase === 'changes'
      ) {
        if (phase === 'design_new') {
          design.pending += 1;
          design.oldest.push(order.creationDate);
        } else if (phase === 'design_working') design.inProgress += 1;
        else design.changesRequested += 1;
        if (tone === 'overdue') design.overdue += 1;
        if (tone === 'at_risk') design.atRisk += 1;
        const person = realPerson(order.assignedUser as PersonRow | null);
        if (person && phase !== 'design_new') design.people.add(person.name);
      } else if (phase === 'waiting_client') design.waitingClient += 1;

      const started =
        phase === 'production'
          ? order.areaTasks.some((t) => t.status !== AreaTaskStatus.pendiente)
          : phase !== 'design_new';
      const verdict = attentionFor(
        {
          phase,
          deliveryDate: order.deliveryDate,
          creationDate: order.creationDate,
          started,
          lastSentAt: revision?.sentAt ?? null,
          lastFeedbackAt: revision?.feedbackAt ?? null,
          readySince: maxDate(order.areaTasks.map((t) => t.completedAt)),
        },
        now,
      );
      if (verdict) {
        attention.push({
          ...toOrderRef(order),
          reason: verdict.reason,
          since: verdict.since?.toISOString() ?? null,
          sinceDate: verdict.since,
          area: order.area,
        });
      }
    }
    attention.sort((a, b) =>
      compareAttention(
        { reason: a.reason, since: a.sinceDate },
        { reason: b.reason, since: b.sinceDate },
      ),
    );

    /* Carga por área */
    const doneToday = new Map(
      doneByArea.map((row) => [row.area, row._count._all]),
    );
    const designOldest = minDate(design.oldest);
    const designLoad: AreaLoad = {
      area: DESIGN_AREA,
      pending: design.pending,
      inProgress: design.inProgress,
      doneToday: approvedToday,
      overdue: design.overdue,
      atRisk: design.atRisk,
      oldestWaitingSince: designOldest?.toISOString() ?? null,
      upcoming: 0,
      changesRequested: design.changesRequested,
      waitingClient: design.waitingClient,
      people: [...design.people].sort(),
      health: areaHealth(
        {
          overdue: design.overdue,
          atRisk: design.atRisk,
          oldestWaitingSince: designOldest,
        },
        now,
      ),
    };
    const productionLoads: AreaLoad[] = PRODUCTION_AREAS.map((area) => {
      const own = tasks.filter(
        (t) => t.area === area && t.status !== AreaTaskStatus.terminado,
      );
      const working = own.filter((t) => t.order.area !== DESIGN_AREA);
      const pendingTasks = working.filter(
        (t) => t.status === AreaTaskStatus.pendiente,
      );
      const inProgress = working.filter(
        (t) => t.status === AreaTaskStatus.en_proceso,
      );
      let overdue = 0;
      let atRisk = 0;
      for (const t of working) {
        const tone = deadlineTone(t.order.deliveryDate, now);
        if (tone === 'overdue') overdue += 1;
        if (tone === 'at_risk') atRisk += 1;
      }
      const oldest = minDate(
        pendingTasks.map((t) => t.order.archivedAt ?? t.createdAt),
      );
      const people = new Set(
        inProgress
          .map((t) => realPerson(t.assignedUser as PersonRow | null)?.name)
          .filter((n): n is string => !!n),
      );
      return {
        area,
        pending: pendingTasks.length,
        inProgress: inProgress.length,
        doneToday: doneToday.get(area) ?? 0,
        overdue,
        atRisk,
        oldestWaitingSince: oldest?.toISOString() ?? null,
        upcoming: own.filter((t) => t.order.area === DESIGN_AREA).length,
        people: [...people].sort(),
        health: areaHealth(
          { overdue, atRisk, oldestWaitingSince: oldest },
          now,
        ),
      };
    });

    /* Ritmo de la semana */
    const dayIndex = (d: Date) =>
      Math.floor((d.getTime() - weekStart.getTime()) / DAY_MS);
    const throughput = Array.from({ length: 7 }, (_, i) => ({
      day: new Date(weekStart.getTime() + i * DAY_MS).toISOString(),
      created: 0,
      delivered: 0,
    }));
    for (const { creationDate } of createdWeek) {
      const i = dayIndex(creationDate);
      if (i >= 0 && i < 7) throughput[i].created += 1;
    }
    const deliveredSeen = new Set<string>();
    for (const { orderId, changeDate } of deliveredWeek) {
      const i = dayIndex(changeDate);
      const key = `${orderId}:${i}`;
      if (i < 0 || i >= 7 || deliveredSeen.has(key)) continue;
      deliveredSeen.add(key);
      throughput[i].delivered += 1;
    }

    return {
      generatedAt: now.toISOString(),
      dayStart: dayStart.toISOString(),
      totals,
      deadlines,
      today: {
        created: createdToday,
        delivered: throughput[6].delivered,
        tasksCompleted: [...doneToday.values()].reduce((a, b) => a + b, 0),
        designsApproved: approvedToday,
      },
      areas: [designLoad, ...productionLoads],
      attention: attention.slice(0, ATTENTION_LIMIT).map(withoutSinceDate),
      attentionTotal: attention.length,
      throughput,
      clientsDue,
      alerts: {
        lowStock: stock.filter((i) => i.stockStatus === 'low').length,
        outOfStock: stock.filter((i) => i.stockStatus === 'out').length,
        lowStockItems: stock.slice(0, LIST_LIMIT),
        purchasesDue,
      },
    };
  }

  /* ------------------------------- Producción ----------------------------- */

  async production(
    user: RequestingUser,
    dayStartParam?: string,
    now = new Date(),
  ): Promise<ProductionDashboard> {
    const dayStart = resolveDayStart(dayStartParam, now);
    const s = await this.ids();
    let areas = user.roles.filter((r) =>
      (PRODUCTION_AREAS as readonly string[]).includes(r),
    );
    if (areas.length === 0 && isFullVisibilityRole(user.roles))
      areas = [...PRODUCTION_AREAS];

    const [me, sharedAccounts, tasks, doneToday, events] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.userId },
        select: { isSharedAccount: true },
      }),
      this.prisma.user.findMany({
        where: { isSharedAccount: true },
        select: { id: true },
      }),
      this.prisma.orderAreaTask.findMany({
        where: {
          area: { in: areas },
          status: { not: AreaTaskStatus.terminado },
          order: { statusId: { notIn: s.closed } },
        },
        select: {
          id: true,
          area: true,
          status: true,
          assignedUserId: true,
          startedAt: true,
          createdAt: true,
          assignedUser: PERSON_SELECT,
          order: {
            select: { ...ORDER_REF_SELECT, area: true, archivedAt: true },
          },
        },
      }),
      this.prisma.orderAreaTask.count({
        where: { area: { in: areas }, completedAt: { gte: dayStart } },
      }),
      this.prisma.calendarEvent.findMany({
        where: {
          area: { in: areas },
          status: { not: AreaTaskStatus.terminado },
          eventDate: {
            gte: dayStart,
            lt: new Date(dayStart.getTime() + 2 * DAY_MS),
          },
        },
        orderBy: { eventDate: 'asc' },
        select: {
          id: true,
          title: true,
          eventDate: true,
          hasTime: true,
          category: true,
          area: true,
          clientName: true,
          orderId: true,
          client: { select: { first_name: true, last_name: true } },
        },
      }),
    ]);

    // Mismo criterio que "Tareas asignadas" (OrderAreaTaskService.findMyTasks):
    // se ve lo libre (sin asignar o de la cuenta compartida) y lo propio; lo
    // que tomó otra persona, no. Desde la cuenta compartida nada es "tuyo".
    const sharedIds = new Set(sharedAccounts.map((u) => u.id));
    const isShared = me?.isSharedAccount === true;
    const isFree = (id: number | null) => id === null || sharedIds.has(id);
    const isMine = (id: number | null) => !isShared && id === user.userId;

    const items: ProductionItem[] = [];
    const upcoming: ProductionDashboard['upcoming'] = [];
    const team = new Map<string, number>();
    for (const task of tasks) {
      if (task.order.area === DESIGN_AREA) {
        upcoming.push({
          ...toOrderRef(task.order),
          area: task.area,
          designStatus: task.order.status.name,
        });
        continue;
      }
      if (task.status === AreaTaskStatus.en_proceso) {
        const person = realPerson(task.assignedUser as PersonRow | null);
        if (person) team.set(person.name, (team.get(person.name) ?? 0) + 1);
      }
      if (!isFree(task.assignedUserId) && !isMine(task.assignedUserId))
        continue;
      items.push({
        ...toOrderRef(task.order),
        key: `task-${task.id}`,
        taskId: task.id,
        area: task.area,
        status: task.status as ProductionItem['status'],
        mine: isMine(task.assignedUserId),
        assignee: isFree(task.assignedUserId)
          ? null
          : realPerson(task.assignedUser as PersonRow | null),
        startedAt: task.startedAt?.toISOString() ?? null,
        availableSince: (task.order.archivedAt ?? task.createdAt).toISOString(),
      });
    }

    const counters = {
      overdue: 0,
      atRisk: 0,
      notStarted: 0,
      inProgress: 0,
      doneToday,
      upcoming: upcoming.length,
    };
    for (const item of items) {
      const tone = deadlineTone(
        item.deliveryDate ? new Date(item.deliveryDate) : null,
        now,
      );
      if (tone === 'overdue') counters.overdue += 1;
      if (tone === 'at_risk') counters.atRisk += 1;
      if (item.status === 'pendiente') counters.notStarted += 1;
      else counters.inProgress += 1;
    }

    upcoming.sort(
      (a, b) =>
        (a.deliveryDate ? Date.parse(a.deliveryDate) : Infinity) -
        (b.deliveryDate ? Date.parse(b.deliveryDate) : Infinity),
    );

    return {
      generatedAt: now.toISOString(),
      dayStart: dayStart.toISOString(),
      areas,
      counters,
      items,
      upcoming: upcoming.slice(0, LIST_LIMIT),
      team: [...team.entries()]
        .map(([name, inProgress]) => ({ name, inProgress }))
        .sort(
          (a, b) =>
            b.inProgress - a.inProgress || a.name.localeCompare(b.name, 'es'),
        ),
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        eventDate: e.eventDate.toISOString(),
        hasTime: e.hasTime,
        category: e.category,
        area: e.area,
        clientName: e.client
          ? [e.client.first_name, e.client.last_name].filter(Boolean).join(' ')
          : e.clientName,
        orderId: e.orderId,
      })),
    };
  }

  /* --------------------------------- Diseño ------------------------------- */

  async design(
    user: RequestingUser,
    dayStartParam?: string,
    now = new Date(),
  ): Promise<DesignDashboard> {
    const dayStart = resolveDayStart(dayStartParam, now);
    const s = await this.ids();
    const weekStart = new Date(dayStart.getTime() - 6 * DAY_MS);

    const [
      me,
      sharedAccounts,
      orders,
      approvedToday,
      approvedWeek,
      approvedLast30,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.userId },
        select: { isSharedAccount: true },
      }),
      this.prisma.user.findMany({
        where: { isSharedAccount: true },
        select: { id: true },
      }),
      this.prisma.order.findMany({
        where: {
          requiresDesign: true,
          area: DESIGN_AREA,
          statusId: { in: [s.enDiseno, s.cambios, s.esperando] },
        },
        select: {
          ...ORDER_REF_SELECT,
          statusId: true,
          designStartedAt: true,
          designStartedByName: true,
          assignedUserId: true,
          assignedUser: PERSON_SELECT,
          productionArea: true,
          areaTasks: { select: { area: true } },
          designRevisions: {
            orderBy: { round: 'desc' },
            take: 1,
            select: { round: true, sentAt: true, feedbackAt: true },
          },
        },
      }),
      this.prisma.designRevision.count({
        where: { approvedAt: { gte: dayStart } },
      }),
      this.prisma.designRevision.count({
        where: { approvedAt: { gte: weekStart } },
      }),
      this.prisma.designRevision.findMany({
        where: {
          approved: true,
          approvedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) },
        },
        select: { round: true },
      }),
    ]);

    const sharedIds = new Set(sharedAccounts.map((u) => u.id));
    const isShared = me?.isSharedAccount === true;
    const isFree = (id: number | null) => id === null || sharedIds.has(id);
    const isMine = (id: number | null) => !isShared && id === user.userId;

    const toItem = (order: (typeof orders)[number]): DesignItem => {
      const revision = order.designRevisions[0];
      const areas = [
        ...new Set(
          [order.productionArea, ...order.areaTasks.map((t) => t.area)].filter(
            (a): a is string => !!a && a !== DESIGN_AREA,
          ),
        ),
      ];
      const availableSince =
        order.statusId === s.cambios
          ? (revision?.feedbackAt ?? order.creationDate)
          : order.creationDate;
      return {
        ...toOrderRef(order),
        key: `design-${order.id}`,
        status: order.status.name,
        mine: isMine(order.assignedUserId),
        assignee: isFree(order.assignedUserId)
          ? null
          : realPerson(order.assignedUser as PersonRow | null),
        designStartedAt: order.designStartedAt?.toISOString() ?? null,
        designStartedByName: order.designStartedByName,
        round: revision?.round ?? 0,
        lastSentAt: revision?.sentAt?.toISOString() ?? null,
        lastFeedbackAt: revision?.feedbackAt?.toISOString() ?? null,
        availableSince: availableSince.toISOString(),
        areas,
      };
    };

    const items: DesignItem[] = [];
    const waiting: DesignItem[] = [];
    const team = new Map<
      string,
      {
        userId: number | null;
        name: string;
        active: number;
        inProgress: number;
      }
    >();
    const counters = {
      changesRequested: 0,
      notStarted: 0,
      inProgress: 0,
      waitingClient: 0,
      overdue: 0,
      atRisk: 0,
      approvedToday,
      approvedWeek,
    };
    let manyRounds = 0;

    for (const order of orders) {
      if (order.statusId === s.esperando) {
        counters.waitingClient += 1;
        waiting.push(toItem(order));
        continue;
      }
      if ((order.designRevisions[0]?.round ?? 0) >= 3) manyRounds += 1;
      // Carga del equipo: todo lo que hay por hacer en Diseño, de quien sea.
      const person = isFree(order.assignedUserId)
        ? null
        : realPerson(order.assignedUser as PersonRow | null);
      const key = person ? `user-${person.id}` : 'free';
      const row = team.get(key) ?? {
        userId: person?.id ?? null,
        name: person?.name ?? 'Sin tomar',
        active: 0,
        inProgress: 0,
      };
      row.active += 1;
      if (order.designStartedAt) row.inProgress += 1;
      team.set(key, row);

      if (!isFree(order.assignedUserId) && !isMine(order.assignedUserId))
        continue;
      const item = toItem(order);
      items.push(item);
      if (order.statusId === s.cambios) counters.changesRequested += 1;
      else if (order.designStartedAt) counters.inProgress += 1;
      else counters.notStarted += 1;
      const tone = deadlineTone(order.deliveryDate, now);
      if (tone === 'overdue') counters.overdue += 1;
      if (tone === 'at_risk') counters.atRisk += 1;
    }

    waiting.sort((a, b) =>
      (a.lastSentAt ?? a.availableSince).localeCompare(
        b.lastSentAt ?? b.availableSince,
      ),
    );

    return {
      generatedAt: now.toISOString(),
      dayStart: dayStart.toISOString(),
      counters,
      items,
      waitingClient: waiting.slice(0, ATTENTION_LIMIT),
      team: [...team.values()].sort(
        (a, b) =>
          (a.userId === null ? 1 : 0) - (b.userId === null ? 1 : 0) ||
          b.active - a.active,
      ),
      rounds: {
        avgToApproval:
          approvedLast30.length > 0
            ? Math.round(
                (approvedLast30.reduce((sum, r) => sum + r.round, 0) /
                  approvedLast30.length) *
                  10,
              ) / 10
            : null,
        approvedLast30: approvedLast30.length,
        manyRounds,
      },
    };
  }
}
