import { OrderService } from './order.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { AreaVisibilityService } from 'src/area-visibility/area-visibility.service';
import { OrderProductPresetService } from 'src/order-product-preset/order-product-preset.service';

describe('OrderService - visibilidad por área (findAll)', () => {
  let orderService: OrderService;
  let prisma: { order: { findMany: jest.Mock } };
  let areaVisibilityService: jest.Mocked<AreaVisibilityService>;

  const orders = [
    {
      id: 1,
      assignedUserId: null,
      area: 'taller',
    },
    {
      id: 2,
      assignedUserId: 42, // asignado a otro usuario
      area: 'taller',
    },
    {
      id: 3,
      assignedUserId: 7, // asignado al usuario que consulta
      area: 'taller',
    },
    {
      id: 4,
      assignedUserId: null,
      area: 'diseno',
    },
    {
      id: 5,
      assignedUserId: null,
      area: null, // pedido viejo sin migrar, sin área
    },
  ];

  beforeEach(() => {
    prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue(orders),
      },
    };

    areaVisibilityService = {
      findAll: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<AreaVisibilityService>;

    orderService = new OrderService(
      prisma as unknown as PrismaService,
      { notifyNewOrderToAdmin: jest.fn() } as unknown as NotificationsGateway,
      areaVisibilityService,
      { ensureExists: jest.fn() } as unknown as OrderProductPresetService,
    );
  });

  it('sin requestingUser: devuelve todos los pedidos (comportamiento actual)', async () => {
    const result = await orderService.findAll();
    expect(result as any[]).toHaveLength(orders.length);
  });

  it('admin: ve todos los pedidos sin filtrar, sin consultar AreaVisibilitySetting', async () => {
    const result = await orderService.findAll(undefined, {
      userId: 99,
      roles: ['admin'],
    });
    expect(result as any[]).toHaveLength(orders.length);
    expect(areaVisibilityService.findAll).not.toHaveBeenCalled();
  });

  it('recepcion: ve todos los pedidos sin filtrar', async () => {
    const result = await orderService.findAll(undefined, {
      userId: 99,
      roles: ['recepcion'],
    });
    expect(result as any[]).toHaveLength(orders.length);
  });

  it('rol operativo con generalViewEnabled=true: ve todos los pedidos de su área', async () => {
    areaVisibilityService.findAll.mockResolvedValue([
      { id: 1, role: 'taller', generalViewEnabled: true },
    ]);

    const result = await orderService.findAll(undefined, {
      userId: 7,
      roles: ['taller'],
    });

    // Solo pedidos del área "taller" (ids 1, 2 y 3)
    expect((result as any[]).map((o: any) => o.id).sort()).toEqual([1, 2, 3]);
  });

  it('rol operativo con generalViewEnabled=false: solo ve pedidos sin asignar o asignados a sí mismo', async () => {
    areaVisibilityService.findAll.mockResolvedValue([
      { id: 1, role: 'taller', generalViewEnabled: false },
    ]);

    const result = await orderService.findAll(undefined, {
      userId: 7,
      roles: ['taller'],
    });

    // id 1 (sin asignar) y 3 (asignado al propio usuario) sí, id 2 (asignado a otro) no.
    expect((result as any[]).map((o: any) => o.id).sort()).toEqual([1, 3]);
  });

  it('rol operativo no incluye pedidos de áreas que no le corresponden ni sin área', async () => {
    areaVisibilityService.findAll.mockResolvedValue([
      { id: 1, role: 'diseno', generalViewEnabled: false },
    ]);

    const result = await orderService.findAll(undefined, {
      userId: 7,
      roles: ['diseno'],
    });

    // Solo el área "diseno" (id 4), que no tiene assignedUserId -> visible.
    // id 5 (area: null) queda fuera aunque no esté asignado.
    expect((result as any[]).map((o: any) => o.id)).toEqual([4]);
  });

  it('usuario con múltiples roles operativos: vista general de uno alcanza para ver toda su área', async () => {
    areaVisibilityService.findAll.mockResolvedValue([
      { id: 1, role: 'taller', generalViewEnabled: true },
      { id: 2, role: 'diseno', generalViewEnabled: false },
    ]);

    const result = await orderService.findAll(undefined, {
      userId: 7,
      roles: ['taller', 'diseno'],
    });

    // taller: vista general -> ve todo (1, 2, 3). diseno: sin vista general,
    // pero id 4 no está asignado -> visible también.
    expect((result as any[]).map((o: any) => o.id).sort()).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('pedidos con area null no son visibles para roles operativos', async () => {
    areaVisibilityService.findAll.mockResolvedValue([
      { id: 1, role: 'taller', generalViewEnabled: true },
    ]);

    const result = await orderService.findAll(undefined, {
      userId: 7,
      roles: ['taller'],
    });

    expect((result as any[]).map((o: any) => o.id)).not.toContain(5);
  });

  it('usuario sin ningún rol operativo ni de visibilidad total no ve pedidos', async () => {
    const result = await orderService.findAll(undefined, {
      userId: 7,
      roles: [],
    });
    expect(result as any[]).toEqual([]);
  });
});
