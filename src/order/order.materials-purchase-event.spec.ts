import { OrderService } from './order.service';
import { OrderAreaTaskService } from './order-area-task.service';
import { CalendarEventService } from 'src/calendar-event/calendar-event.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { AreaVisibilityService } from 'src/area-visibility/area-visibility.service';
import { OrderProductPresetService } from 'src/order-product-preset/order-product-preset.service';
import { NotificationService } from 'src/notification/notification.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';

/**
 * Regresión: si un pedido ya tenía materiales cargados pero todavía no
 * tenía fecha de entrega, `OrderMaterialItemService.create` no pudo calcular
 * "una semana antes" — este es el otro disparador: en cuanto se le pone la
 * fecha de entrega, se crea recién ahí (ver OrderService.update).
 */
describe('OrderService.update - aviso de compra de materiales al ponerle fecha de entrega', () => {
  let orderService: OrderService;
  let prisma: any;
  let ensureMaterialsPurchaseEvent: jest.Mock;

  const existingOrder = {
    id: 123,
    description: 'Playeras',
    deliveryDate: null as Date | null,
    assignedUserId: null,
    area: 'taller',
    productionArea: null,
    requiresDesign: false,
    clientId: 1,
    clientNameOverride: null,
    userId: 9,
    status: { id: 6, name: 'en diseño' },
  };

  const buildUpdatedOrder = (overrides: Record<string, unknown> = {}) => ({
    ...existingOrder,
    ...overrides,
  });

  beforeEach(() => {
    ensureMaterialsPurchaseEvent = jest.fn().mockResolvedValue(undefined);
    prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue(existingOrder),
        update: jest.fn().mockResolvedValue(buildUpdatedOrder()),
      },
      orderAuditLog: { create: jest.fn() },
      orderMaterialItem: { count: jest.fn().mockResolvedValue(0) },
    };

    orderService = new OrderService(
      prisma as unknown as PrismaService,
      { notifyOrderStatusChange: jest.fn() } as unknown as NotificationsGateway,
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
      { ensureMaterialsPurchaseEvent } as unknown as CalendarEventService,
    );
  });

  it('al ponerle fecha de entrega a un pedido con materiales ya cargados, crea el aviso', async () => {
    const deliveryDate = new Date('2026-10-15T00:00:00.000Z');
    prisma.order.update.mockResolvedValue(buildUpdatedOrder({ deliveryDate }));
    prisma.orderMaterialItem.count.mockResolvedValue(3);

    await orderService.update(
      123,
      { deliveryDate: deliveryDate.toISOString() } as any,
      9,
    );

    expect(ensureMaterialsPurchaseEvent).toHaveBeenCalledWith(
      123,
      deliveryDate,
      9,
    );
  });

  it('no crea nada si el pedido no tiene materiales cargados', async () => {
    const deliveryDate = new Date('2026-10-15T00:00:00.000Z');
    prisma.order.update.mockResolvedValue(buildUpdatedOrder({ deliveryDate }));
    prisma.orderMaterialItem.count.mockResolvedValue(0);

    await orderService.update(
      123,
      { deliveryDate: deliveryDate.toISOString() } as any,
      9,
    );

    expect(ensureMaterialsPurchaseEvent).not.toHaveBeenCalled();
  });

  it('no hace nada si el pedido ya tenía fecha de entrega (no es la primera vez que se define)', async () => {
    const alreadyHadDate = {
      ...existingOrder,
      deliveryDate: new Date('2026-09-01T00:00:00.000Z'),
    };
    prisma.order.findUnique.mockResolvedValue(alreadyHadDate);
    const newDeliveryDate = new Date('2026-10-15T00:00:00.000Z');
    prisma.order.update.mockResolvedValue(
      buildUpdatedOrder({ deliveryDate: newDeliveryDate }),
    );
    prisma.orderMaterialItem.count.mockResolvedValue(3);

    await orderService.update(
      123,
      { deliveryDate: newDeliveryDate.toISOString() } as any,
      9,
    );

    expect(ensureMaterialsPurchaseEvent).not.toHaveBeenCalled();
  });
});
