import { HttpException, HttpStatus } from '@nestjs/common';
import { OrderService } from './order.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { AreaVisibilityService } from 'src/area-visibility/area-visibility.service';
import { OrderProductPresetService } from 'src/order-product-preset/order-product-preset.service';
import { NotificationService } from 'src/notification/notification.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { RequestingUser } from './order.service';

describe('OrderService.bulkUpdateStatusOrArea', () => {
  let orderService: OrderService;
  let prisma: any;
  let auditLogService: { record: jest.Mock };

  const requestingUser: RequestingUser = {
    userId: 1,
    roles: ['admin'],
    username: 'admin',
  };

  const buildOrder = (id: number) => ({
    id,
    area: 'taller',
    assignedUserId: null,
  });

  beforeEach(() => {
    prisma = {
      order: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    auditLogService = { record: jest.fn() };

    orderService = new OrderService(
      prisma as unknown as PrismaService,
      {} as unknown as NotificationsGateway,
      {} as unknown as AreaVisibilityService,
      { ensureExists: jest.fn() } as unknown as OrderProductPresetService,
      {} as unknown as NotificationService,
      auditLogService as unknown as AuditLogService,
    );
  });

  it('rechaza el request si no viene statusId ni area', async () => {
    await expect(
      orderService.bulkUpdateStatusOrArea(
        { orderIds: [1, 2] } as any,
        requestingUser,
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    } as Partial<HttpException>);
  });

  it('aplica el cambio a todos los pedidos válidos en una sola transacción', async () => {
    prisma.order.findUnique.mockImplementation(({ where: { id } }) =>
      Promise.resolve(buildOrder(id)),
    );
    prisma.$transaction.mockResolvedValue([{}, {}]);

    const result = await orderService.bulkUpdateStatusOrArea(
      { orderIds: [1, 2], statusId: 3 } as any,
      requestingUser,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result.results).toEqual([
      { orderId: 1, success: true },
      { orderId: 2, success: true },
    ]);
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'order.bulk_status_area_update',
        entityType: 'order_bulk',
      }),
    );
  });

  it('reporta como fallido un id sin acceso, sin abortar el resto', async () => {
    prisma.order.findUnique.mockImplementation(({ where: { id } }) =>
      Promise.resolve(id === 2 ? null : buildOrder(id)),
    );
    prisma.$transaction.mockResolvedValue([{}]);

    const result = await orderService.bulkUpdateStatusOrArea(
      { orderIds: [1, 2], statusId: 3 } as any,
      requestingUser,
    );

    expect(result.results).toEqual([
      { orderId: 1, success: true },
      {
        orderId: 2,
        success: false,
        error: 'Orden no encontrada',
      },
    ]);
  });

  it('si la transacción falla, marca todos los ids aceptados como fallidos', async () => {
    prisma.order.findUnique.mockImplementation(({ where: { id } }) =>
      Promise.resolve(buildOrder(id)),
    );
    prisma.$transaction.mockRejectedValue({ code: 'P2003' });

    const result = await orderService.bulkUpdateStatusOrArea(
      { orderIds: [1, 2], statusId: 999 } as any,
      requestingUser,
    );

    expect(result.results).toEqual([
      { orderId: 1, success: false, error: 'ID de estado inválido' },
      { orderId: 2, success: false, error: 'ID de estado inválido' },
    ]);
  });
});
