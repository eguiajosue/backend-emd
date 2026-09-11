import { HttpStatus } from '@nestjs/common';
import { OrderService, RequestingUser } from './order.service';
import { OrderAreaTaskService } from './order-area-task.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { AreaVisibilityService } from 'src/area-visibility/area-visibility.service';
import { OrderProductPresetService } from 'src/order-product-preset/order-product-preset.service';
import { NotificationService } from 'src/notification/notification.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';

/** Id del estado "entregado" (ver STATUS_SEEDS en prisma/seed.ts). */
const DELIVERED_STATUS_ID = 5;

/**
 * La entrega la confirma Recepción a mano (WORKFLOW.md §3): producción termina
 * su tarea de área, pero no cierra el pedido.
 */
describe('OrderService - quién puede marcar ENTREGADO', () => {
  let orderService: OrderService;
  let prisma: any;

  const bordador: RequestingUser = { userId: 3, roles: ['bordado'] };
  const receptionist: RequestingUser = { userId: 1, roles: ['recepcion'] };

  beforeEach(() => {
    prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          area: 'bordado',
          assignedUserId: null,
          userId: 77,
          statusId: 4,
          description: 'x',
          deliveryDate: null,
          status: { id: 4, name: 'terminado' },
        }),
        update: jest.fn().mockResolvedValue({
          id: 1,
          assignedUserId: null,
          status: { id: DELIVERED_STATUS_ID, name: 'entregado' },
        }),
      },
      orderHistory: { create: jest.fn() },
      orderAuditLog: { create: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    orderService = new OrderService(
      prisma as unknown as PrismaService,
      {
        notifyOrderStatusChange: jest.fn(),
        notifyOrderStatusChangedToRecepcion: jest.fn(),
        notifyNewAssignedOrder: jest.fn(),
        notifyNewOrderToArea: jest.fn(),
      } as unknown as NotificationsGateway,
      {} as unknown as AreaVisibilityService,
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

  describe('PATCH /orders/:id', () => {
    it('rechaza con 403 a un rol de producción', async () => {
      await expect(
        orderService.update(
          1,
          { statusId: DELIVERED_STATUS_ID } as any,
          bordador.userId,
          bordador,
        ),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('deja pasar a Recepción', async () => {
      await expect(
        orderService.update(
          1,
          { statusId: DELIVERED_STATUS_ID } as any,
          receptionist.userId,
          receptionist,
        ),
      ).resolves.toBeDefined();
    });

    it('no bloquea otros cambios de estado hechos por producción', async () => {
      await expect(
        orderService.update(
          1,
          { statusId: 3 } as any,
          bordador.userId,
          bordador,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('POST /orders/bulk-actions', () => {
    it('rechaza con 403 a un rol de producción', async () => {
      await expect(
        orderService.bulkUpdateStatusOrArea(
          { orderIds: [1], statusId: DELIVERED_STATUS_ID } as any,
          bordador,
        ),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('deja pasar a Recepción', async () => {
      await expect(
        orderService.bulkUpdateStatusOrArea(
          { orderIds: [1], statusId: DELIVERED_STATUS_ID } as any,
          receptionist,
        ),
      ).resolves.toBeDefined();
    });
  });
});
