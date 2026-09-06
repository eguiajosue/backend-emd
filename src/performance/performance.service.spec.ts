import { PerformanceService } from './performance.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PerformanceService.getSummary', () => {
  const DELIVERED_STATUS = { id: 5, name: 'entregado' };

  function buildPrismaMock(overrides: {
    users?: any[];
    orders?: any[];
    histories?: any[];
  }) {
    return {
      status: {
        findUnique: jest.fn().mockResolvedValue(DELIVERED_STATUS),
      },
      orderHistory: {
        findMany: jest.fn().mockResolvedValue(overrides.histories ?? []),
      },
      user: {
        findMany: jest.fn().mockResolvedValue(overrides.users ?? []),
      },
      order: {
        findMany: jest.fn().mockResolvedValue(overrides.orders ?? []),
      },
    } as unknown as PrismaService;
  }

  it('sin usuarios ni pedidos: devuelve arrays vacíos', async () => {
    const prisma = buildPrismaMock({});
    const service = new PerformanceService(prisma);
    const result = await service.getSummary();
    expect(result.employees).toEqual([]);
    expect(result.areas).toEqual([]);
  });

  it('empleado con menos de 2 completados: score null (datos insuficientes)', async () => {
    const now = new Date('2026-01-10T00:00:00Z');
    const prisma = buildPrismaMock({
      users: [
        {
          id: 1,
          firstName: 'Ana',
          lastName: 'Lopez',
          username: 'ana',
          assignedOrders: [
            {
              id: 100,
              creationDate: now,
              deliveryDate: null,
              status: { name: 'entregado' },
            },
          ],
        },
      ],
      histories: [
        {
          orderId: 100,
          changeDate: new Date('2026-01-11T00:00:00Z'),
        },
      ],
    });
    const service = new PerformanceService(prisma);
    const result = await service.getSummary();
    expect(result.employees).toHaveLength(1);
    expect(result.employees[0].totalCompleted).toBe(1);
    expect(result.employees[0].score).toBeNull();
  });

  it('calcula avgTurnaroundHours, onTimeRate y score comparando dos empleados', async () => {
    const creation = new Date('2026-01-01T00:00:00Z');
    const prisma = buildPrismaMock({
      users: [
        {
          id: 1,
          firstName: 'Rapido',
          lastName: null,
          username: 'rapido',
          assignedOrders: [
            {
              id: 1,
              creationDate: creation,
              deliveryDate: new Date('2026-01-05T00:00:00Z'),
              status: { name: 'entregado' },
            },
            {
              id: 2,
              creationDate: creation,
              deliveryDate: new Date('2026-01-05T00:00:00Z'),
              status: { name: 'entregado' },
            },
          ],
        },
        {
          id: 2,
          firstName: 'Lento',
          lastName: null,
          username: 'lento',
          assignedOrders: [
            {
              id: 3,
              creationDate: creation,
              deliveryDate: new Date('2026-01-02T00:00:00Z'),
              status: { name: 'entregado' },
            },
            {
              id: 4,
              creationDate: creation,
              deliveryDate: new Date('2026-01-02T00:00:00Z'),
              status: { name: 'entregado' },
            },
          ],
        },
      ],
      histories: [
        { orderId: 1, changeDate: new Date('2026-01-02T00:00:00Z') }, // 24h, on time
        { orderId: 2, changeDate: new Date('2026-01-02T00:00:00Z') }, // 24h, on time
        { orderId: 3, changeDate: new Date('2026-01-10T00:00:00Z') }, // 216h, late
        { orderId: 4, changeDate: new Date('2026-01-10T00:00:00Z') }, // 216h, late
      ],
    });
    const service = new PerformanceService(prisma);
    const result = await service.getSummary();

    expect(result.employees).toHaveLength(2);
    const rapido = result.employees.find((e) => e.userId === 1)!;
    const lento = result.employees.find((e) => e.userId === 2)!;

    expect(rapido.avgTurnaroundHours).toBeCloseTo(24);
    expect(rapido.onTimeRate).toBe(1);
    expect(lento.avgTurnaroundHours).toBeCloseTo(216);
    expect(lento.onTimeRate).toBe(0);

    // Rápido y a tiempo debe rankear mejor que lento y tarde.
    expect(rapido.score).not.toBeNull();
    expect(lento.score).not.toBeNull();
    expect(rapido.score as number).toBeGreaterThan(lento.score as number);
    // Ordenado por score descendente.
    expect(result.employees[0].userId).toBe(1);
  });

  it('pedido completado sin registro de historial: se ignora del promedio sin romper', async () => {
    const creation = new Date('2026-01-01T00:00:00Z');
    const prisma = buildPrismaMock({
      users: [
        {
          id: 1,
          firstName: 'Ana',
          lastName: null,
          username: 'ana',
          assignedOrders: [
            {
              id: 1,
              creationDate: creation,
              deliveryDate: null,
              status: { name: 'entregado' },
            },
            {
              id: 2,
              creationDate: creation,
              deliveryDate: null,
              status: { name: 'entregado' },
            },
          ],
        },
      ],
      histories: [{ orderId: 1, changeDate: new Date('2026-01-02T00:00:00Z') }],
    });
    const service = new PerformanceService(prisma);
    const result = await service.getSummary();
    expect(result.employees[0].totalCompleted).toBe(2);
    expect(result.employees[0].avgTurnaroundHours).toBeCloseTo(24);
  });

  it('agrupa métricas por área usando todos los pedidos del área', async () => {
    const creation = new Date('2026-01-01T00:00:00Z');
    const prisma = buildPrismaMock({
      orders: [
        {
          id: 1,
          area: 'taller',
          creationDate: creation,
          deliveryDate: new Date('2026-01-05T00:00:00Z'),
          status: { name: 'entregado' },
        },
        {
          id: 2,
          area: 'taller',
          creationDate: creation,
          deliveryDate: null,
          status: { name: 'pendiente' },
        },
      ],
      histories: [{ orderId: 1, changeDate: new Date('2026-01-02T00:00:00Z') }],
    });
    const service = new PerformanceService(prisma);
    const result = await service.getSummary();
    expect(result.areas).toHaveLength(1);
    expect(result.areas[0].area).toBe('taller');
    expect(result.areas[0].totalAssigned).toBe(2);
    expect(result.areas[0].totalCompleted).toBe(1);
  });
});
