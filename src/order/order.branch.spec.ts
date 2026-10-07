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
