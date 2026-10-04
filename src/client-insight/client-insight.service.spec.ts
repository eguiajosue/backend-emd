import { EventEmitter } from 'node:events';
import { NotFoundException } from '@nestjs/common';
import { ClientInsightService } from './client-insight.service';
import { ENGINE_VERSION } from './client-insight.engine';
import { DataChange, PrismaService } from '../prisma/prisma.service';

const order = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  creationDate: new Date(),
  deliveryDate: null,
  requiresDesign: true,
  productionArea: 'impresiones',
  area: 'diseno',
  areaTasks: [{ area: 'impresiones' }],
  orderProducts: [{ customName: 'Figuras', quantity: 12 }],
  materialItems: [],
  ...overrides,
});

describe('ClientInsightService', () => {
  let service: ClientInsightService;
  let changes: EventEmitter;
  let prisma: {
    changes: EventEmitter;
    client: { findUnique: jest.Mock; findMany: jest.Mock };
    clientInsight: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      findMany: jest.Mock;
    };
    order: { findMany: jest.Mock; findUnique: jest.Mock };
  };

  const emit = (change: Partial<DataChange>) => changes.emit('change', change);

  beforeEach(() => {
    jest.useFakeTimers();
    changes = new EventEmitter();
    prisma = {
      changes,
      client: {
        findUnique: jest.fn().mockResolvedValue({ id: 3 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      clientInsight: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      order: {
        findMany: jest
          .fn()
          .mockResolvedValue([order({ id: 1 }), order({ id: 2 })]),
        findUnique: jest.fn(),
      },
    };
    service = new ClientInsightService(prisma as unknown as PrismaService);
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('aprende del historial sin contar los pedidos cancelados y guarda el perfil', async () => {
    const profile = await service.rebuild(3);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 3, status: { name: { not: 'cancelado' } } },
        orderBy: { creationDate: 'desc' },
        take: 60,
      }),
    );
    expect(profile.ordersAnalyzed).toBe(2);
    expect(prisma.clientInsight.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 3 },
        create: expect.objectContaining({
          clientId: 3,
          version: ENGINE_VERSION,
          ordersAnalyzed: 2,
        }),
      }),
    );
  });

  it('devuelve el perfil guardado si está al día y lo re-aprende si es de otra versión', async () => {
    prisma.clientInsight.findUnique.mockResolvedValueOnce({
      version: ENGINE_VERSION,
      updatedAt: new Date(),
      profile: { ordersAnalyzed: 9 },
    });
    await expect(service.getProfile(3)).resolves.toEqual({ ordersAnalyzed: 9 });
    expect(prisma.order.findMany).not.toHaveBeenCalled();

    prisma.clientInsight.findUnique.mockResolvedValueOnce({
      version: ENGINE_VERSION - 1,
      updatedAt: new Date(),
      profile: { ordersAnalyzed: 9 },
    });
    await expect(service.getProfile(3)).resolves.toMatchObject({
      ordersAnalyzed: 2,
    });
  });

  it('cliente inexistente: 404', async () => {
    prisma.client.findUnique.mockResolvedValue(null);
    await expect(service.getProfile(99)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('aprende solo al crear un pedido (feed de escrituras), una vez por cliente', async () => {
    emit({
      model: 'Order',
      action: 'create',
      args: {},
      result: { id: 10, clientId: 3 },
    });
    emit({
      model: 'OrderMaterialItem',
      action: 'create',
      args: {},
      result: { orderId: 10 },
    });
    prisma.order.findMany.mockResolvedValueOnce([{ clientId: 3 }]);
    // El aviso queda agendado (agrupa las escrituras del mismo alta)...
    expect(jest.getTimerCount()).toBe(1);
    // ...y al vencer aprende una sola vez del cliente.
    await service.flush();
    expect(jest.getTimerCount()).toBe(0);
    const rebuilds = prisma.clientInsight.upsert.mock.calls.filter(
      ([arg]) => arg.where.clientId === 3,
    );
    expect(rebuilds).toHaveLength(1);
  });

  it('ignora cambios que no afectan lo aprendido (prioridad de compra, avance de tareas)', async () => {
    emit({
      model: 'Order',
      action: 'update',
      args: { where: { id: 5 }, data: { materialsPriority: 2 } },
      result: { clientId: 3 },
    });
    emit({
      model: 'OrderAreaTask',
      action: 'update',
      args: { where: { id: 1 }, data: { status: 'terminado' } },
      result: { orderId: 5 },
    });
    emit({ model: 'Client', action: 'update', args: {}, result: {} });
    await service.flush();
    expect(prisma.clientInsight.upsert).not.toHaveBeenCalled();
  });

  it('un cambio de estado (ej. cancelar) por updateMany re-aprende de los clientes de esos pedidos', async () => {
    prisma.order.findMany
      .mockResolvedValueOnce([
        { clientId: 3 },
        { clientId: 4 },
        { clientId: null },
      ])
      .mockResolvedValue([order()]);
    emit({
      model: 'Order',
      action: 'updateMany',
      args: { where: { id: { in: [5, 6, 7] } }, data: { statusId: 10 } },
      result: { count: 3 },
    });
    await service.flush();
    expect(
      prisma.clientInsight.upsert.mock.calls.map(([arg]) => arg.where.clientId),
    ).toEqual([3, 4]);
  });

  it('un error al aprender nunca se propaga', async () => {
    prisma.order.findMany.mockRejectedValue(new Error('db caída'));
    emit({
      model: 'Order',
      action: 'create',
      args: {},
      result: { clientId: 3 },
    });
    await expect(service.flush()).resolves.toBeUndefined();
  });

  it('clientes por pedir: arma nombre, último pedido y lo que más pide', async () => {
    const next = new Date('2026-10-05T12:00:00Z');
    prisma.clientInsight.findMany.mockResolvedValue([
      {
        clientId: 3,
        lastOrderAt: new Date('2026-09-05T12:00:00Z'),
        nextExpectedAt: next,
        ordersAnalyzed: 7,
        profile: {
          cadence: { medianDays: 30 },
          products: [{ name: 'Figuras' }],
        },
        client: { first_name: 'Luis', last_name: 'García' },
      },
    ]);
    const due = await service.dueClients(new Date('2026-10-03T12:00:00Z'));
    expect(prisma.clientInsight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ cadenceRegular: true }),
      }),
    );
    expect(due).toEqual([
      {
        clientId: 3,
        clientName: 'Luis García',
        lastOrderAt: '2026-09-05T12:00:00.000Z',
        nextExpectedAt: next.toISOString(),
        medianDays: 30,
        topProduct: 'Figuras',
        ordersAnalyzed: 7,
      },
    ]);
  });
});
