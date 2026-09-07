import { OrderService } from './order.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { AreaVisibilityService } from 'src/area-visibility/area-visibility.service';
import { OrderProductPresetService } from 'src/order-product-preset/order-product-preset.service';
import { NotificationService } from 'src/notification/notification.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';

describe('OrderService.update - notificación de cambio de estado', () => {
  let orderService: OrderService;
  let prisma: any;
  let gateway: any;
  let notificationService: any;

  const existingOrder = {
    id: 123,
    description: 'Playeras',
    deliveryDate: null,
    assignedUserId: null,
    area: 'taller',
    productionArea: null,
    requiresDesign: false,
    clientId: 1,
    clientNameOverride: null,
    status: { id: 6, name: 'en diseño' },
  };

  const buildUpdatedOrder = (overrides: Record<string, unknown> = {}) => ({
    ...existingOrder,
    status: { id: 4, name: 'terminado' },
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue(existingOrder),
        update: jest.fn().mockResolvedValue(buildUpdatedOrder()),
      },
      orderAuditLog: { create: jest.fn() },
    };
    gateway = {
      notifyOrderStatusChange: jest.fn(),
      notifyOrderStatusChangedToRecepcion: jest.fn(),
      notifyAreaUserUpdatedOrder: jest.fn(),
    };
    notificationService = {
      createNotification: jest.fn(),
      createNotificationForUsers: jest.fn(),
      userIdsForArea: jest.fn().mockResolvedValue([10, 11]),
    };

    orderService = new OrderService(
      prisma as unknown as PrismaService,
      gateway as unknown as NotificationsGateway,
      {} as unknown as AreaVisibilityService,
      { ensureExists: jest.fn() } as unknown as OrderProductPresetService,
      notificationService as unknown as NotificationService,
      { record: jest.fn() } as unknown as AuditLogService,
    );
  });

  const update = (dto: any, user?: any) =>
    orderService.update(123, dto, user?.userId, user);

  it('persiste una notificación tipo "order_status_changed" para Recepción con el texto legible', async () => {
    await update(
      { statusId: 4 },
      { userId: 7, roles: ['taller'], username: 'Ana' },
    );

    expect(notificationService.createNotificationForUsers).toHaveBeenCalledWith(
      [10, 11],
      expect.objectContaining({
        type: 'order_status_changed',
        orderId: 123,
        body: 'Ana cambió el estado del pedido #123 de "en diseño" a "terminado"',
      }),
    );
  });

  it('emite el evento WS específico con estado previo, nuevo, autor y timestamp', async () => {
    await update(
      { statusId: 4 },
      { userId: 7, roles: ['taller'], username: 'Ana' },
    );

    expect(gateway.notifyOrderStatusChangedToRecepcion).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 123,
        changedByUsername: 'Ana',
        previousStatus: 'en diseño',
        newStatus: 'terminado',
        changedAt: expect.any(Date),
      }),
    );
  });

  it('incluye al usuario asignado como destinatario, sin duplicarlo si además es de recepción', async () => {
    prisma.order.update.mockResolvedValue(
      buildUpdatedOrder({ assignedUserId: 11 }),
    );

    await update(
      { statusId: 4 },
      { userId: 7, roles: ['taller'], username: 'Ana' },
    );

    expect(notificationService.createNotificationForUsers).toHaveBeenCalledWith(
      [10, 11],
      expect.anything(),
    );
  });

  it('notifica también cuando el cambio lo hace admin/recepción (cualquier usuario)', async () => {
    await update(
      { statusId: 4 },
      { userId: 1, roles: ['admin'], username: 'Root' },
    );

    expect(gateway.notifyOrderStatusChangedToRecepcion).toHaveBeenCalled();
    // La notificación genérica de "usuario de área actualizó" no aplica.
    expect(gateway.notifyAreaUserUpdatedOrder).not.toHaveBeenCalled();
  });

  it('no emite nada si el estado no cambió', async () => {
    prisma.order.update.mockResolvedValue(
      buildUpdatedOrder({ status: existingOrder.status }),
    );

    await update(
      { description: 'Otra cosa' },
      { userId: 7, roles: ['taller'], username: 'Ana' },
    );

    expect(gateway.notifyOrderStatusChangedToRecepcion).not.toHaveBeenCalled();
    expect(notificationService.createNotificationForUsers).toHaveBeenCalledWith(
      [10, 11],
      expect.objectContaining({ type: 'area_user_updated_order' }),
    );
  });

  it('un cambio de estado no genera además la notificación genérica (statusId fuera de la auditoría)', async () => {
    await update(
      { statusId: 4 },
      { userId: 7, roles: ['taller'], username: 'Ana' },
    );

    const types = notificationService.createNotificationForUsers.mock.calls.map(
      (call: any[]) => call[1].type,
    );
    expect(types).toEqual(['order_status_changed']);
    expect(gateway.notifyAreaUserUpdatedOrder).not.toHaveBeenCalled();
    expect(prisma.orderAuditLog.create).not.toHaveBeenCalled();
  });
});
