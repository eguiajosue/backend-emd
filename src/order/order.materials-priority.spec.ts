import { HttpException } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderAreaTaskService } from './order-area-task.service';
import { CalendarEventService } from 'src/calendar-event/calendar-event.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { AreaVisibilityService } from 'src/area-visibility/area-visibility.service';
import { OrderProductPresetService } from 'src/order-product-preset/order-product-preset.service';
import { NotificationService } from 'src/notification/notification.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';

describe('OrderService.reorderMaterialsPriority', () => {
  let orderService: OrderService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      order: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    orderService = new OrderService(
      prisma as unknown as PrismaService,
      {} as unknown as NotificationsGateway,
      {} as unknown as AreaVisibilityService,
      { ensureExists: jest.fn() } as unknown as OrderProductPresetService,
      {} as unknown as NotificationService,
      { record: jest.fn() } as unknown as AuditLogService,
      { createTasksForAreas: jest.fn() } as unknown as OrderAreaTaskService,
      {
        ensureMaterialsPurchaseEvent: jest.fn(),
      } as unknown as CalendarEventService,
    );
  });

  it('rechaza si algún id no existe', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 1 }]);

    await expect(orderService.reorderMaterialsPriority([1, 2])).rejects.toThrow(
      HttpException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('guarda el índice de cada id como materialsPriority en una sola transacción', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 5 }, { id: 3 }, { id: 9 }]);
    prisma.$transaction.mockResolvedValue([{}, {}, {}]);

    const result = await orderService.reorderMaterialsPriority([5, 3, 9]);

    expect(result).toEqual({ updated: 3 });
    expect(prisma.order.update).toHaveBeenCalledTimes(3);
    expect(prisma.order.update).toHaveBeenNthCalledWith(1, {
      where: { id: 5 },
      data: { materialsPriority: 0 },
    });
    expect(prisma.order.update).toHaveBeenNthCalledWith(2, {
      where: { id: 3 },
      data: { materialsPriority: 1 },
    });
    expect(prisma.order.update).toHaveBeenNthCalledWith(3, {
      where: { id: 9 },
      data: { materialsPriority: 2 },
    });
  });
});
