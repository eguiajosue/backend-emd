import { OrderService } from './order.service';

/** Alta y visibilidad de pedidos desde la cuenta de sucursal (Punto Madero). */
describe('OrderService - sucursal', () => {
  let prisma: any;
  let gateway: any;
  let notifications: any;
  let service: OrderService;
  const branchUser = {
    userId: 7,
    roles: ['sucursal'],
    username: 'puntomadero',
  };
  const dto: any = {
    userId: 7,
    clientNameOverride: 'Cliente',
    requiresDesign: false,
    area: 'taller',
    description: 'Playeras',
    orderProducts: [{ customName: 'Playera', quantity: 2 }],
  };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          branch: { id: 1, name: 'Punto Madero', active: true },
        }),
        // Cuenta compartida de Diseño ("Cualquier diseñador").
        findFirst: jest.fn().mockResolvedValue({ id: 40 }),
      },
      status: {
        findUnique: jest.fn().mockResolvedValue({ id: 21 }),
        findFirst: jest.fn().mockResolvedValue({ id: 21 }),
      },
      branchEmployee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 5,
          branchId: 1,
          name: 'Ana López',
          active: true,
        }),
      },
      order: {
        create: jest.fn().mockResolvedValue({
          id: 90,
          description: 'Playeras',
          clientNameOverride: 'Cliente',
          client: null,
          user: { username: 'puntomadero' },
          area: 'taller',
          assignedUserId: null,
        }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    gateway = {
      notifyNewOrderToAdmin: jest.fn(),
      notifyNewOrderToArea: jest.fn(),
      notifyNewAssignedOrder: jest.fn(),
    };
    notifications = {
      createNotification: jest.fn(),
      createNotificationForUsers: jest.fn(),
      userIdsForArea: jest.fn().mockResolvedValue([3]),
    };
    service = new OrderService(
      prisma,
      gateway,
      {} as any,
      { ensureExists: jest.fn() } as any,
      notifications,
      { record: jest.fn() } as any,
      { createTasksForAreas: jest.fn().mockResolvedValue([]) } as any,
      { ensureMaterialsPurchaseEvent: jest.fn() } as any,
    );
  });

  it('exige el empleado al crear desde la sucursal', async () => {
    await expect(service.create(dto, branchUser)).rejects.toMatchObject({
      status: 400,
    });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('rechaza un empleado de otra sucursal', async () => {
    prisma.branchEmployee.findUnique.mockResolvedValue({
      id: 5,
      branchId: 2,
      active: true,
    });
    await expect(
      service.create({ ...dto, branchEmployeeId: 5 }, branchUser),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rechaza un empleado inactivo', async () => {
    prisma.branchEmployee.findUnique.mockResolvedValue({
      id: 5,
      branchId: 1,
      active: false,
    });
    await expect(
      service.create({ ...dto, branchEmployeeId: 5 }, branchUser),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('guarda sucursal y empleado, y avisa a Recepción mencionando la sucursal', async () => {
    await service.create({ ...dto, branchEmployeeId: 5 }, branchUser);
    const data = prisma.order.create.mock.calls[0][0].data;
    expect(data.branch).toEqual({ connect: { id: 1 } });
    expect(data.branchEmployee).toEqual({ connect: { id: 5 } });
    expect(gateway.notifyNewOrderToAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        branchName: 'Punto Madero',
        createdBy: 'Punto Madero · Ana López',
      }),
    );
    expect(notifications.createNotificationForUsers).toHaveBeenCalledWith(
      [3],
      expect.objectContaining({ title: 'Nuevo pedido de Punto Madero' }),
    );
  });

  it('la sucursal no controla estado, diseño, área ni a nombre de quién queda', async () => {
    await service.create(
      {
        ...dto,
        branchEmployeeId: 5,
        statusId: 9,
        requiresDesign: false,
        area: 'bordado',
        userId: 99,
        assignedUserId: 55,
      },
      branchUser,
    );
    const data = prisma.order.create.mock.calls[0][0].data;
    // Alta estándar: pasa por Diseño, en "en diseño", a nombre de la cuenta.
    expect(data.requiresDesign).toBe(true);
    expect(data.area).toBe('diseno');
    expect(data.status).toEqual({ connect: { id: 21 } });
    expect(data.user).toEqual({ connect: { id: 7 } });
    // El responsable es la cuenta compartida de Diseño, no el que mandó.
    expect(data.assignedUser).toEqual({ connect: { id: 40 } });
  });

  it('Recepción no necesita empleado y el pedido queda sin sucursal', async () => {
    await service.create(dto, { userId: 2, roles: ['recepcion'] });
    const data = prisma.order.create.mock.calls[0][0].data;
    expect(data.branch).toBeUndefined();
    expect(data.branchEmployee).toBeUndefined();
  });

  it('el listado de la sucursal se filtra a SUS pedidos', async () => {
    await service.findAll(undefined, branchUser);
    expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({
      branch: { users: { some: { id: 7 } } },
    });
  });

  describe('historial propio (GET /orders con filtros)', () => {
    const branchScope = { branch: { users: { some: { id: 7 } } } };

    beforeEach(() => {
      prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) =>
        Promise.all(ops),
      );
      prisma.order.count.mockResolvedValue(0);
    });

    it('sin filtros lista TODOS sus pedidos (sin excluir terminados/entregados), más reciente primero', async () => {
      await service.findAll(undefined, branchUser);
      const args = prisma.order.findMany.mock.calls[0][0];
      expect(JSON.stringify(args.where)).not.toMatch(/statusId|archivedAt/);
      expect(args.orderBy).toEqual([{ creationDate: 'desc' }, { id: 'desc' }]);
    });

    it('incluye empleado, cliente, estado y productos', async () => {
      await service.findAll(undefined, branchUser);
      const { select } = prisma.order.findMany.mock.calls[0][0];
      expect(select.branchEmployee).toEqual({
        select: { id: true, name: true },
      });
      expect(select.client).toBe(true);
      expect(select.status).toBe(true);
      expect(select.orderProducts).toBe(true);
    });

    it('statusId y rango from/to se aplican en AND con el alcance de la sucursal', async () => {
      await service.findAll(
        { statusId: 4, from: '2026-10-01', to: '2026-10-07' },
        branchUser,
      );
      const { where } = prisma.order.findMany.mock.calls[0][0];
      expect(where.AND[0]).toEqual(branchScope);
      expect(where.AND[1]).toEqual({
        statusId: 4,
        creationDate: {
          gte: new Date('2026-10-01'),
          lte: new Date('2026-10-07T23:59:59.999Z'),
        },
      });
    });

    it('q busca por id, descripción, nombre libre, cliente y empresa', async () => {
      await service.findAll({ q: ' 42 ' }, branchUser);
      const { where } = prisma.order.findMany.mock.calls[0][0];
      const or = where.AND[1].OR;
      expect(where.AND[0]).toEqual(branchScope);
      expect(or).toEqual(
        expect.arrayContaining([
          { id: 42 },
          { description: { contains: '42', mode: 'insensitive' } },
          { clientNameOverride: { contains: '42', mode: 'insensitive' } },
        ]),
      );
      expect(JSON.stringify(or)).toContain('first_name');
      expect(JSON.stringify(or)).toContain('company');
    });

    it('un q de texto no genera filtro por id', async () => {
      await service.findAll({ q: 'gorras' }, branchUser);
      const or = prisma.order.findMany.mock.calls[0][0].where.AND[1].OR;
      expect(or.some((c: any) => 'id' in c)).toBe(false);
    });

    it('paginación: page/limit con total y meta', async () => {
      prisma.order.count.mockResolvedValue(45);
      const res: any = await service.findAll(
        { page: 2, limit: 20 },
        branchUser,
      );
      const args = prisma.order.findMany.mock.calls[0][0];
      expect(args.skip).toBe(20);
      expect(args.take).toBe(20);
      expect(res.meta).toEqual({
        total: 45,
        page: 2,
        limit: 20,
        totalPages: 3,
      });
    });

    it('el orden por id se conserva para la matriz', async () => {
      await service.findAll(undefined, { userId: 2, roles: ['recepcion'] });
      expect(prisma.order.findMany.mock.calls[0][0].orderBy).toEqual([
        { id: 'desc' },
      ]);
    });
  });

  describe('cliente del pedido de sucursal', () => {
    beforeEach(() => {
      prisma.client = { findUnique: jest.fn() };
    });

    it('acepta un cliente de SU sucursal', async () => {
      prisma.client.findUnique.mockResolvedValue({ branchId: 1 });
      await service.create(
        { ...dto, clientId: 10, branchEmployeeId: 5 },
        branchUser,
      );
      expect(prisma.order.create).toHaveBeenCalled();
    });

    it.each([
      ['de la matriz', { branchId: null }],
      ['de otra sucursal', { branchId: 2 }],
      ['inexistente', null],
    ])('rechaza (400) un cliente %s', async (_n, client) => {
      prisma.client.findUnique.mockResolvedValue(client);
      await expect(
        service.create(
          { ...dto, clientId: 10, branchEmployeeId: 5 },
          branchUser,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('Recepción puede usar cualquier cliente (no se valida sucursal)', async () => {
      await service.create(
        { ...dto, clientId: 10 },
        { userId: 2, roles: ['recepcion'] },
      );
      expect(prisma.client.findUnique).not.toHaveBeenCalled();
    });
  });

  it('assertOrderAccess niega un pedido que no es de la sucursal', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 1,
      area: 'taller',
      assignedUserId: null,
      userId: 2,
      attendedByUserId: null,
    });
    prisma.order.count.mockResolvedValue(0);
    await expect(
      service.assertOrderAccess(1, branchUser),
    ).rejects.toMatchObject({ status: 403 });
    prisma.order.count.mockResolvedValue(1);
    await expect(
      service.assertOrderAccess(1, branchUser),
    ).resolves.toMatchObject({ id: 1 });
  });
});
