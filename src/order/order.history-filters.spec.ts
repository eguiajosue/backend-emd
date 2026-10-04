import { OrderService } from './order.service';

/**
 * Búsqueda y filtros del Historial (`GET /orders/history`): se arman en la
 * base, siempre en AND con la visibilidad por rol.
 */
describe('OrderService.findHistory - búsqueda y filtros', () => {
  let prisma: any;
  let service: OrderService;

  beforeEach(() => {
    prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const noop = {} as any;
    service = new OrderService(
      prisma,
      noop,
      noop,
      noop,
      noop,
      noop,
      noop,
      noop,
    );
  });

  const whereOf = () => prisma.order.findMany.mock.calls[0][0].where;

  it('sin filtros sólo aplica la visibilidad', async () => {
    await service.findHistory({}, { userId: 1, roles: ['admin'] });
    expect(whereOf()).toEqual({ AND: [{}, {}] });
  });

  it('un código de pedido busca por id y también por texto', async () => {
    await service.findHistory(
      { q: 'EMD-P0042' },
      { userId: 1, roles: ['admin'] },
    );
    const [, filters] = whereOf().AND;
    const or = filters.AND[0].OR;
    expect(or[0]).toEqual({ id: 42 });
    expect(or).toContainEqual({
      description: { contains: 'EMD-P0042', mode: 'insensitive' },
    });
    expect(or).toContainEqual({
      client: {
        company: { name: { contains: 'EMD-P0042', mode: 'insensitive' } },
      },
    });
  });

  it('texto libre no agrega búsqueda por id', async () => {
    await service.findHistory(
      { q: 'playeras' },
      { userId: 1, roles: ['admin'] },
    );
    const [, filters] = whereOf().AND;
    expect(filters.AND[0].OR.some((c: object) => 'id' in c)).toBe(false);
  });

  it('combina estado, área, cliente y rango de fechas', async () => {
    await service.findHistory(
      {
        statusId: 5,
        area: 'dtf',
        clientId: 3,
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      },
      { userId: 1, roles: ['admin'] },
    );
    const [, filters] = whereOf().AND;
    expect(filters.AND).toEqual([
      { statusId: 5 },
      { OR: [{ area: 'dtf' }, { areaTasks: { some: { area: 'dtf' } } }] },
      { clientId: 3 },
      {
        creationDate: {
          gte: new Date('2026-01-01'),
          lte: new Date('2026-01-31'),
        },
      },
    ]);
  });

  it('un rol operativo no puede saltarse su visibilidad pidiendo otra área', async () => {
    await service.findHistory(
      { area: 'bordado' },
      { userId: 2, roles: ['dtf'] },
    );
    const [visibility, filters] = whereOf().AND;
    expect(visibility).toEqual({ area: { in: ['dtf'] } });
    expect(filters.AND).toEqual([
      {
        OR: [{ area: 'bordado' }, { areaTasks: { some: { area: 'bordado' } } }],
      },
    ]);
  });
});
