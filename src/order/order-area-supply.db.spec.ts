import { AreaTaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderAreaTaskService } from './order-area-task.service';
import { NotificationService } from 'src/notification/notification.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';

/**
 * Concurrencia REAL contra Postgres (sin mocks de Prisma): dos peticiones
 * simultáneas que terminan (o reabren) la misma tarea deben mover el
 * inventario UNA sola vez.
 *
 * Sólo corre si hay una base de pruebas: SUPPLY_TEST_DATABASE_URL (migrada a
 * HEAD, descartable). Sin esa variable se omite.
 *   SUPPLY_TEST_DATABASE_URL="postgresql://postgres@localhost:5499/<db>?host=/tmp" npx jest order-area-supply.db
 */
const URL = process.env.SUPPLY_TEST_DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

const ROUNDS = 12;
const STATUS_NAMES = [
  'en diseño',
  'cambios solicitados',
  'terminado',
  'autorizado',
  'entregado',
  'cancelado',
];

describeDb('Hoja de materiales: concurrencia real en Postgres', () => {
  let prisma: PrismaService;
  let service: OrderAreaTaskService;
  let userId: number;
  let statusId: number;
  const itemIds: number[] = [];
  const orderIds: number[] = [];
  const createdStatusIds: number[] = [];
  const actor = { userId: 0, roles: ['recepcion'] };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    prisma = new PrismaService();
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        firstName: 'Prueba',
        username: `concurrencia-${Date.now()}`,
        password: 'x',
      },
    });
    userId = user.id;
    actor.userId = userId;
    for (const name of STATUS_NAMES) {
      const existing = await prisma.status.findUnique({ where: { name } });
      if (existing) {
        if (name === 'autorizado') statusId = existing.id;
        continue;
      }
      const created = await prisma.status.create({ data: { name } });
      createdStatusIds.push(created.id);
    }
    statusId = (await prisma.status.findUnique({
      where: { name: 'autorizado' },
    }))!.id;
    service = new OrderAreaTaskService(
      prisma,
      {
        userIdsForArea: jest.fn().mockResolvedValue([]),
        createNotificationForUsers: jest.fn().mockResolvedValue(undefined),
        createNotification: jest.fn().mockResolvedValue(undefined),
      } as unknown as NotificationService,
      { notifyNewOrderToArea: jest.fn() } as unknown as NotificationsGateway,
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.inventoryMovement.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.orderHistory.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => 0);
    await prisma.status
      .deleteMany({ where: { id: { in: createdStatusIds } } })
      .catch(() => 0);
    await prisma.$disconnect();
  });

  /** Pedido con una tarea de bordado y una línea de `quantity` de un artículo. */
  async function setup(opts: {
    taskStatus: AreaTaskStatus;
    stock: number;
    quantity: number;
    discounted?: boolean;
  }) {
    const item = await prisma.inventoryItem.create({
      data: {
        area: 'bordado',
        name: `Hilo prueba ${Date.now()}-${Math.random()}`,
        unit: 'cono',
        quantity: opts.stock,
      },
    });
    itemIds.push(item.id);
    const order = await prisma.order.create({
      data: {
        description: 'Prueba concurrencia',
        creationDate: new Date(),
        userId,
        statusId,
        area: 'bordado',
        areaTasks: {
          create: {
            area: 'bordado',
            status: opts.taskStatus,
            supply: {
              create: {
                source: 'nosotros',
                createdById: userId,
                lines: {
                  create: {
                    inventoryItemId: item.id,
                    description: item.name,
                    quantity: opts.quantity,
                    discountedAt: opts.discounted ? new Date() : null,
                  },
                },
              },
            },
          },
        },
      },
      include: { areaTasks: true },
    });
    orderIds.push(order.id);
    return { item, order, task: order.areaTasks[0] };
  }

  const stockOf = async (id: number) =>
    Number(
      (await prisma.inventoryItem.findUnique({ where: { id } }))!.quantity,
    );
  const movementsOf = (itemId: number) =>
    prisma.inventoryMovement.findMany({
      where: { itemId },
      orderBy: { id: 'asc' },
    });

  it(`dos "terminado" simultáneos descuentan UNA vez (x${ROUNDS})`, async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const { item, task } = await setup({
        taskStatus: AreaTaskStatus.en_proceso,
        stock: 10,
        quantity: 2,
      });
      const results = await Promise.allSettled([
        service.updateStatus(task.id, AreaTaskStatus.terminado, actor),
        service.updateStatus(task.id, AreaTaskStatus.terminado, actor),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await stockOf(item.id)).toBe(8);
      const movements = await movementsOf(item.id);
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        type: 'SALIDA',
        source: 'orden',
        area: 'bordado',
        areaTaskId: task.id,
      });
      expect(Number(movements[0].balanceBefore)).toBe(10);
    }
  }, 120000);

  it(`dos reaperturas simultáneas devuelven el stock UNA vez (x${ROUNDS})`, async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const { item, task } = await setup({
        taskStatus: AreaTaskStatus.terminado,
        stock: 8,
        quantity: 2,
        discounted: true,
      });
      const results = await Promise.allSettled([
        service.updateStatus(task.id, AreaTaskStatus.en_proceso, actor),
        service.updateStatus(task.id, AreaTaskStatus.en_proceso, actor),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await stockOf(item.id)).toBe(10);
      const movements = await movementsOf(item.id);
      expect(movements).toHaveLength(1);
      expect(movements[0].type).toBe('ENTRADA');
    }
  }, 120000);

  it('terminar con stock insuficiente deja la tarea terminada y la línea pendiente; discountPending la salda una vez', async () => {
    const { item, order, task } = await setup({
      taskStatus: AreaTaskStatus.en_proceso,
      stock: 1,
      quantity: 3,
    });
    await service.updateStatus(task.id, AreaTaskStatus.terminado, actor);
    expect(
      (await prisma.orderAreaTask.findUnique({ where: { id: task.id } }))!
        .status,
    ).toBe('terminado');
    expect(await stockOf(item.id)).toBe(1);

    let sheet = await service.getSupplySheet(order.id, actor);
    expect(sheet.areas[0].pendingDiscount).toBe(true);
    expect(sheet.areas[0].supply!.lines[0]).toMatchObject({
      pendingDiscount: true,
      shortfall: 2,
    });

    // Reintento sin stock: no falla ni mueve nada.
    await service.discountPending(order.id, 'bordado', actor);
    expect(await stockOf(item.id)).toBe(1);

    // Entra inventario; dos reintentos simultáneos descuentan una sola vez.
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: 5 },
    });
    await Promise.all([
      service.discountPending(order.id, 'bordado', actor),
      service.discountPending(order.id, 'bordado', actor),
    ]);
    expect(await stockOf(item.id)).toBe(2);
    expect(await movementsOf(item.id)).toHaveLength(1);
    sheet = await service.getSupplySheet(order.id, actor);
    expect(sheet.areas[0].pendingDiscount).toBe(false);
  }, 60000);

  it('PUT de la hoja contra un "terminado" simultáneo: nunca se pierde ni se duplica el descuento', async () => {
    for (let i = 0; i < 6; i++) {
      const { item, order, task } = await setup({
        taskStatus: AreaTaskStatus.en_proceso,
        stock: 10,
        quantity: 2,
      });
      const other = await prisma.inventoryItem.create({
        data: {
          area: 'bordado',
          name: `Otro ${Math.random()}`,
          unit: 'pieza',
          quantity: 10,
        },
      });
      itemIds.push(other.id);
      const results = await Promise.allSettled([
        service.updateStatus(task.id, AreaTaskStatus.terminado, actor),
        service.saveSupplies(
          order.id,
          [
            {
              area: 'bordado',
              source: 'nosotros',
              lines: [{ inventoryItemId: other.id, quantity: 1 }],
            },
          ],
          actor,
        ),
      ]);
      // Termina primero (el PUT da 409) o el PUT gana (y se descuenta lo nuevo):
      // en ambos casos el stock refleja EXACTAMENTE una hoja.
      expect(results[0].status).toBe('fulfilled');
      const a = await stockOf(item.id);
      const b = await stockOf(other.id);
      const putWon = results[1].status === 'fulfilled';
      if (putWon) {
        expect([a, b]).toEqual([10, 9]);
      } else {
        expect([a, b]).toEqual([8, 10]);
      }
    }
  }, 120000);
});
