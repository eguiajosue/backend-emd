import { OrderService } from './order.service';
import { OrderAreaTaskService } from './order-area-task.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { AreaVisibilityService } from 'src/area-visibility/area-visibility.service';
import { OrderProductPresetService } from 'src/order-product-preset/order-product-preset.service';
import { NotificationService } from 'src/notification/notification.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';

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
      {
        createNotification: jest.fn(),
        createNotificationForUsers: jest.fn(),
        userIdsForArea: jest.fn().mockResolvedValue([]),
      } as unknown as NotificationService,
      { record: jest.fn() } as unknown as AuditLogService,
      {
        createTasksForAreas: jest.fn().mockResolvedValue([]),
      } as unknown as OrderAreaTaskService,
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

  it('rol operativo: ve todos los pedidos de su área, asignados o no, sin consultar AreaVisibilitySetting', async () => {
    const result = await orderService.findAll(undefined, {
      userId: 7,
      roles: ['taller'],
    });

    // Todos los pedidos del área "taller" (ids 1, 2 y 3), incluido el
    // asignado a otro usuario (id 2): la colaboración intra-área no se
    // bloquea por asignación individual.
    expect((result as any[]).map((o: any) => o.id).sort()).toEqual([1, 2, 3]);
    expect(areaVisibilityService.findAll).not.toHaveBeenCalled();
  });

  it('diseñador: ve cualquier pedido de "diseno", esté o no asignado a él', async () => {
    const result = await orderService.findAll(undefined, {
      userId: 7,
      roles: ['diseno'],
    });

    // Solo el área "diseno" (id 4). id 5 (area: null) queda fuera.
    expect((result as any[]).map((o: any) => o.id)).toEqual([4]);
  });

  it('usuario con múltiples roles operativos: ve todos los pedidos de todas sus áreas', async () => {
    const result = await orderService.findAll(undefined, {
      userId: 7,
      roles: ['taller', 'diseno'],
    });

    expect((result as any[]).map((o: any) => o.id).sort()).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('pedidos con area null no son visibles para roles operativos', async () => {
    const result = await orderService.findAll(undefined, {
      userId: 7,
      roles: ['taller'],
    });

    expect((result as any[]).map((o: any) => o.id)).not.toContain(5);
  });

  it('superuser: ve todos los pedidos sin filtrar', async () => {
    const result = await orderService.findAll(undefined, {
      userId: 99,
      roles: ['superuser'],
    });
    expect(result as any[]).toHaveLength(orders.length);
  });

  it.each(['taller', 'dtf', 'bordado', 'diseno', 'laser', 'impresiones'])(
    'rol operativo "%s" no ve pedidos de otras áreas',
    async (role) => {
      const result = await orderService.findAll(undefined, {
        userId: 7,
        roles: [role],
      });
      const visibleAreas = new Set((result as any[]).map((o: any) => o.area));
      for (const area of visibleAreas) {
        expect(area).toBe(role);
      }
    },
  );

  it('usuario con roles diseno+bordado+dtf (caso reportado) ve las órdenes de esas áreas sin ser bloqueado', async () => {
    const result = await orderService.findAll(undefined, {
      userId: 7,
      roles: ['diseno', 'bordado', 'dtf'],
    });

    // Sólo hay pedidos de "diseno" en el fixture (id 4); no debe lanzar ni
    // devolver pedidos de áreas que no le corresponden.
    expect((result as any[]).map((o: any) => o.id)).toEqual([4]);
  });

  it('usuario sin ningún rol operativo ni de visibilidad total no ve pedidos', async () => {
    const result = await orderService.findAll(undefined, {
      userId: 7,
      roles: [],
    });
    expect(result as any[]).toEqual([]);
  });
});
