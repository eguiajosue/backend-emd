import { DashboardService, resolveDayStart } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClientInsightService } from '../client-insight/client-insight.service';

const NOW = new Date('2026-10-03T18:00:00Z');
const DAY_START = '2026-10-03T06:00:00.000Z';
const H = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * H);

const STATUS_IDS: Record<string, number> = {
  pendiente: 1,
  'en proceso': 3,
  terminado: 4,
  entregado: 5,
  'en diseño': 6,
  'esperando autorización': 7,
  'cambios solicitados': 8,
  autorizado: 9,
  cancelado: 10,
};
const statusName = (id: number) =>
  Object.keys(STATUS_IDS).find((k) => STATUS_IDS[k] === id)!;

const person = (id: number, firstName: string, isSharedAccount = false) => ({
  id,
  firstName,
  lastName: null,
  username: firstName.toLowerCase(),
  isSharedAccount,
});
const SHARED_TALLER = person(90, 'Taller', true);
const ANA = person(7, 'Ana');
const BETO = person(8, 'Beto');

const orderRef = (
  id: number,
  statusId: number,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  description: `Pedido ${id}`,
  deliveryDate: at(24 * 5),
  creationDate: at(-24),
  clientNameOverride: null,
  client: { first_name: 'Luis', last_name: 'García' },
  orderProducts: [{ customName: 'Figuras', quantity: 12 }],
  status: { name: statusName(statusId) },
  statusId,
  ...overrides,
});

function buildPrisma() {
  return {
    status: {
      findUnique: jest.fn(({ where: { name } }) =>
        Promise.resolve({ id: STATUS_IDS[name], name }),
      ),
    },
    order: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    orderAreaTask: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    orderHistory: { findMany: jest.fn().mockResolvedValue([]) },
    designRevision: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    inventoryItem: { findMany: jest.fn().mockResolvedValue([]) },
    calendarEvent: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ isSharedAccount: false }),
      findMany: jest.fn().mockResolvedValue([{ id: SHARED_TALLER.id }]),
    },
  };
}

describe('resolveDayStart', () => {
  it('usa el inicio del día local que manda el frontend', () => {
    expect(resolveDayStart(DAY_START, NOW).toISOString()).toBe(DAY_START);
  });
  it('sin parámetro o con uno absurdo, medianoche UTC', () => {
    expect(resolveDayStart(undefined, NOW).toISOString()).toBe(
      '2026-10-03T00:00:00.000Z',
    );
    expect(resolveDayStart('2020-01-01T00:00:00Z', NOW).toISOString()).toBe(
      '2026-10-03T00:00:00.000Z',
    );
    expect(resolveDayStart('2026-10-05T00:00:00Z', NOW).toISOString()).toBe(
      '2026-10-03T00:00:00.000Z',
    );
  });
});

describe('DashboardService', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let insights: { dueClients: jest.Mock };
  let service: DashboardService;

  beforeEach(() => {
    prisma = buildPrisma();
    insights = {
      dueClients: jest
        .fn()
        .mockResolvedValue([{ clientId: 3, clientName: 'Luis García' }]),
    };
    service = new DashboardService(
      prisma as unknown as PrismaService,
      insights as unknown as ClientInsightService,
    );
  });

  describe('reception', () => {
    it('totales, plazos, atención, carga por área y ritmo de la semana', async () => {
      prisma.order.findMany.mockImplementation(({ where }) => {
        if (where?.statusId?.notIn) {
          return Promise.resolve([
            // Diseño nuevo sin abrir desde hace 2 días y vencido
            orderRef(1, 6, {
              area: 'diseno',
              deliveryDate: at(-2),
              creationDate: at(-48),
              designStartedAt: null,
              assignedUser: null,
              areaTasks: [],
              designRevisions: [],
            }),
            // Esperando autorización hace 3 días
            orderRef(2, 7, {
              area: 'diseno',
              designStartedAt: at(-90),
              assignedUser: ANA,
              areaTasks: [],
              designRevisions: [
                { round: 1, sentAt: at(-72), feedbackAt: null },
              ],
            }),
            // En producción, a tiempo
            orderRef(3, 1, {
              area: 'taller',
              designStartedAt: null,
              assignedUser: SHARED_TALLER,
              areaTasks: [{ status: 'en_proceso', completedAt: null }],
              designRevisions: [],
            }),
            // Listo desde hace 2 días
            orderRef(4, 4, {
              area: 'taller',
              designStartedAt: null,
              assignedUser: null,
              areaTasks: [{ status: 'terminado', completedAt: at(-50) }],
              designRevisions: [],
            }),
            // En producción sin fecha
            orderRef(5, 1, {
              area: 'bordado',
              deliveryDate: null,
              designStartedAt: null,
              assignedUser: null,
              areaTasks: [{ status: 'pendiente', completedAt: null }],
              designRevisions: [],
            }),
          ]);
        }
        // Creados en la semana
        return Promise.resolve([
          { creationDate: at(-1) },
          { creationDate: at(-2) },
          { creationDate: at(-30) },
        ]);
      });
      prisma.orderAreaTask.findMany.mockResolvedValue([
        {
          area: 'taller',
          status: 'en_proceso',
          createdAt: at(-30),
          assignedUser: BETO,
          order: { area: 'taller', deliveryDate: at(24 * 5), archivedAt: null },
        },
        {
          area: 'bordado',
          status: 'pendiente',
          createdAt: at(-30),
          assignedUser: null,
          order: { area: 'bordado', deliveryDate: null, archivedAt: null },
        },
        {
          area: 'impresiones',
          status: 'pendiente',
          createdAt: at(-48),
          assignedUser: null,
          order: { area: 'diseno', deliveryDate: at(-2), archivedAt: null },
        },
      ]);
      prisma.orderAreaTask.groupBy.mockResolvedValue([
        { area: 'taller', _count: { _all: 2 } },
      ]);
      prisma.order.count.mockResolvedValue(2);
      prisma.orderHistory.findMany.mockResolvedValue([
        { orderId: 9, changeDate: at(-2) },
        { orderId: 9, changeDate: at(-1) },
      ]);
      prisma.designRevision.count.mockResolvedValue(1);
      prisma.inventoryItem.findMany.mockResolvedValue([
        {
          id: 1,
          name: 'Hilo rojo',
          area: 'bordado',
          unit: 'cono',
          quantity: 0,
          minStock: 3,
        },
        {
          id: 2,
          name: 'Tinta cyan',
          area: 'impresiones',
          unit: 'litro',
          quantity: 1,
          minStock: 2,
        },
        {
          id: 3,
          name: 'Vinil',
          area: 'impresiones',
          unit: 'rollo',
          quantity: 9,
          minStock: 2,
        },
      ]);
      prisma.calendarEvent.count.mockResolvedValue(2);

      const d = await service.reception(DAY_START, NOW);

      expect(d.totals).toEqual({
        active: 5,
        inDesign: 1,
        waitingClient: 1,
        inProduction: 2,
        ready: 1,
        noDate: 1,
      });
      expect(d.deadlines).toEqual({
        overdue: 1,
        atRisk: 0,
        onTime: 2,
        noDate: 1,
      });
      expect(d.today).toEqual({
        created: 2,
        delivered: 1,
        tasksCompleted: 2,
        designsApproved: 1,
      });
      expect(d.attention.map((a) => [a.id, a.reason])).toEqual([
        [1, 'overdue'],
        [4, 'ready_not_delivered'],
        [2, 'waiting_client'],
        [5, 'no_date'],
      ]);
      expect(d.attention[0]).toMatchObject({
        clientName: 'Luis García',
        products: [{ customName: 'Figuras', quantity: 12 }],
      });

      const design = d.areas.find((a) => a.area === 'diseno')!;
      expect(design).toMatchObject({
        pending: 1,
        waitingClient: 1,
        overdue: 1,
        doneToday: 1,
        health: 'critical',
      });
      const taller = d.areas.find((a) => a.area === 'taller')!;
      expect(taller).toMatchObject({
        inProgress: 1,
        doneToday: 2,
        people: ['Beto'],
        health: 'ok',
      });
      const bordado = d.areas.find((a) => a.area === 'bordado')!;
      expect(bordado).toMatchObject({ pending: 1, health: 'warning' });
      // La tarea de un pedido que sigue en Diseño es "próxima", no trabajo actual.
      const impresiones = d.areas.find((a) => a.area === 'impresiones')!;
      expect(impresiones).toMatchObject({
        pending: 0,
        upcoming: 1,
        overdue: 0,
        health: 'ok',
      });

      expect(d.throughput).toHaveLength(7);
      expect(d.throughput[6].day).toBe(DAY_START);
      expect(d.throughput.reduce((s, x) => s + x.created, 0)).toBe(3);
      expect(d.clientsDue).toEqual([
        { clientId: 3, clientName: 'Luis García' },
      ]);
      expect(d.alerts).toMatchObject({
        lowStock: 1,
        outOfStock: 1,
        purchasesDue: 2,
      });
      expect(d.alerts.lowStockItems.map((i) => i.name)).toEqual([
        'Hilo rojo',
        'Tinta cyan',
      ]);
    });
  });

  describe('production', () => {
    const task = (id: number, overrides: Record<string, unknown> = {}) => ({
      id,
      area: 'taller',
      status: 'pendiente',
      assignedUserId: null,
      startedAt: null,
      createdAt: at(-10),
      assignedUser: null,
      order: { ...orderRef(100 + id, 1), area: 'taller', archivedAt: null },
      ...overrides,
    });

    it('muestra lo libre y lo propio, oculta lo que tomó otra persona y separa lo que viene de Diseño', async () => {
      prisma.orderAreaTask.findMany.mockResolvedValue([
        task(1),
        task(2, {
          assignedUserId: SHARED_TALLER.id,
          assignedUser: SHARED_TALLER,
        }),
        task(3, {
          status: 'en_proceso',
          assignedUserId: ANA.id,
          assignedUser: ANA,
          startedAt: at(-1),
        }),
        task(4, {
          status: 'en_proceso',
          assignedUserId: BETO.id,
          assignedUser: BETO,
        }),
        task(5, {
          order: {
            ...orderRef(105, 6, { deliveryDate: at(30) }),
            area: 'diseno',
            archivedAt: null,
          },
        }),
        task(6, {
          order: {
            ...orderRef(106, 9, { deliveryDate: at(-3) }),
            area: 'taller',
            archivedAt: at(-20),
          },
        }),
      ]);
      prisma.orderAreaTask.count.mockResolvedValue(4);

      const d = await service.production(
        { userId: ANA.id, roles: ['taller'] },
        DAY_START,
        NOW,
      );

      expect(d.areas).toEqual(['taller']);
      expect(d.items.map((i) => [i.taskId, i.mine])).toEqual([
        [1, false],
        [2, false],
        [3, true],
        [6, false],
      ]);
      expect(d.items.find((i) => i.taskId === 6)?.availableSince).toBe(
        at(-20).toISOString(),
      );
      expect(d.counters).toEqual({
        overdue: 1,
        atRisk: 0,
        notStarted: 3,
        inProgress: 1,
        doneToday: 4,
        upcoming: 1,
      });
      expect(d.upcoming).toEqual([
        expect.objectContaining({
          id: 105,
          area: 'taller',
          designStatus: 'en diseño',
        }),
      ]);
      expect(d.team).toEqual([
        { name: 'Ana', inProgress: 1 },
        { name: 'Beto', inProgress: 1 },
      ]);
    });

    it('desde la cuenta compartida nada es "tuyo"', async () => {
      prisma.user.findUnique.mockResolvedValue({ isSharedAccount: true });
      prisma.orderAreaTask.findMany.mockResolvedValue([
        task(1, {
          assignedUserId: SHARED_TALLER.id,
          assignedUser: SHARED_TALLER,
        }),
      ]);
      const d = await service.production(
        { userId: SHARED_TALLER.id, roles: ['taller'] },
        DAY_START,
        NOW,
      );
      expect(d.items.map((i) => i.mine)).toEqual([false]);
    });

    it('admin sin áreas ve todas las de producción', async () => {
      const d = await service.production(
        { userId: 1, roles: ['admin'] },
        DAY_START,
        NOW,
      );
      expect(d.areas).toEqual([
        'taller',
        'dtf',
        'bordado',
        'laser',
        'impresiones',
      ]);
    });
  });

  describe('design', () => {
    it('bandeja (libre + propio), esperando al cliente, carga del equipo y rondas', async () => {
      const designOrder = (
        id: number,
        statusId: number,
        overrides: Record<string, unknown> = {},
      ) => ({
        ...orderRef(id, statusId),
        designStartedAt: null,
        designStartedByName: null,
        assignedUserId: null,
        assignedUser: null,
        productionArea: 'impresiones',
        areaTasks: [{ area: 'impresiones' }],
        designRevisions: [],
        ...overrides,
      });
      prisma.order.findMany.mockResolvedValue([
        designOrder(1, 6),
        designOrder(2, 6, {
          designStartedAt: at(-3),
          assignedUserId: ANA.id,
          assignedUser: ANA,
        }),
        designOrder(3, 8, {
          assignedUserId: BETO.id,
          assignedUser: BETO,
          designStartedAt: at(-50),
          designRevisions: [{ round: 3, sentAt: at(-40), feedbackAt: at(-30) }],
        }),
        designOrder(4, 7, {
          designRevisions: [{ round: 1, sentAt: at(-60), feedbackAt: null }],
        }),
        designOrder(5, 8, {
          deliveryDate: at(-1),
          designRevisions: [{ round: 2, sentAt: at(-20), feedbackAt: at(-5) }],
        }),
      ]);
      prisma.designRevision.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(4);
      prisma.designRevision.findMany.mockResolvedValue([
        { round: 1 },
        { round: 2 },
      ]);

      const d = await service.design(
        { userId: ANA.id, roles: ['diseno'] },
        DAY_START,
        NOW,
      );

      expect(d.items.map((i) => [i.id, i.mine])).toEqual([
        [1, false],
        [2, true],
        [5, false],
      ]);
      expect(d.items.find((i) => i.id === 5)).toMatchObject({
        round: 2,
        availableSince: at(-5).toISOString(),
        areas: ['impresiones'],
      });
      expect(d.counters).toEqual({
        changesRequested: 1,
        notStarted: 1,
        inProgress: 1,
        waitingClient: 1,
        overdue: 1,
        atRisk: 0,
        approvedToday: 1,
        approvedWeek: 4,
      });
      expect(d.waitingClient.map((i) => i.id)).toEqual([4]);
      expect(d.team).toEqual([
        { userId: ANA.id, name: 'Ana', active: 1, inProgress: 1 },
        { userId: BETO.id, name: 'Beto', active: 1, inProgress: 1 },
        { userId: null, name: 'Sin tomar', active: 2, inProgress: 0 },
      ]);
      expect(d.rounds).toEqual({
        avgToApproval: 1.5,
        approvedLast30: 2,
        manyRounds: 1,
      });
    });
  });
});
