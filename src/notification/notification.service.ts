import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildPaginatedResult,
  PaginationQueryDto,
  resolvePagination,
} from 'src/common/dto/pagination-query.dto';
import { PushService } from 'src/push/push.service';
import { ExpoPushService } from 'src/push/expo-push.service';

/** Datos necesarios para crear una notificación persistente. */
export interface CreateNotificationInput {
  userId: number;
  type: string;
  title: string;
  body?: string;
  orderId?: number;
}

/**
 * Tipos de notificación (`Notification.type`) que hoy existen y se
 * consideran "novedades de producción" a efectos del filtro
 * `notifyProductionUpdates` (asignación/estado de pedidos, tareas de área,
 * montajes de diseño). Cualquier tipo que no esté acá se trata como alerta
 * general y cae bajo `notifyCriticalAlerts` — así un tipo nuevo que se
 * agregue sin actualizar esta lista no queda silenciado por error.
 */
const PRODUCTION_NOTIFICATION_TYPES = new Set([
  'order_assigned',
  'order_status_changed',
  'area_task_created',
  'area_task_completed',
  'order_ready',
  'area_user_updated_order',
  'design_montage_sent',
  'design_feedback_added',
  'design_approved',
]);

/**
 * Tipos de notificación que representan una mención directa al usuario. El
 * sistema todavía no implementa @menciones reales en el chat (Fase 4 no las
 * agrega), así que este set queda vacío a propósito: `notifyMentionsOnly`
 * no tiene, hoy, ningún tipo que pase el filtro. Ver comentario en
 * `shouldNotify` sobre por qué eso no bloquea notificaciones legítimas.
 */
const MENTION_NOTIFICATION_TYPES = new Set<string>([]);

type NotificationPreferences = {
  notificationsMuted: boolean;
  notifyMentionsOnly: boolean;
  notifyProductionUpdates: boolean;
  notifyCriticalAlerts: boolean;
};

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
    private readonly expoPushService: ExpoPushService,
  ) {}

  /**
   * Decide si una notificación de `type` debe llegar (persistirse + push)
   * a un usuario dadas sus preferencias. Único punto de decisión: tanto
   * `createNotification` como `createNotificationForUsers` pasan por acá
   * antes de tocar la base o disparar el push.
   *
   * - `notificationsMuted`: corta todo, salvo una mención directa (si
   *   existiera ese tipo hoy).
   * - `notifyMentionsOnly`: en teoría restringe a sólo menciones, pero como
   *   el sistema no tiene todavía un tipo de notificación de "mención"
   *   (no hay @menciones de chat implementadas), `MENTION_NOTIFICATION_TYPES`
   *   está vacío y este filtro queda sin efecto práctico — no bloquea
   *   notificaciones legítimas por error. Cuando exista un tipo de mención
   *   real, agregarlo a `MENTION_NOTIFICATION_TYPES` activa el filtro solo.
   * - Si no, se clasifica el tipo como "producción" o "alerta general" y se
   *   respeta el toggle correspondiente.
   */
  private shouldNotify(
    prefs: NotificationPreferences | null | undefined,
    type: string,
  ): boolean {
    // Sin preferencias resueltas (usuario no encontrado, etc.): no bloquear
    // por un fallo ajeno a la decisión de notificar.
    if (!prefs) return true;

    const isMention = MENTION_NOTIFICATION_TYPES.has(type);

    if (prefs.notificationsMuted) {
      return isMention;
    }
    if (prefs.notifyMentionsOnly) {
      return isMention;
    }
    if (PRODUCTION_NOTIFICATION_TYPES.has(type)) {
      return prefs.notifyProductionUpdates;
    }
    return prefs.notifyCriticalAlerts;
  }

  private async getNotificationPreferences(
    userId: number,
  ): Promise<NotificationPreferences | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        notificationsMuted: true,
        notifyMentionsOnly: true,
        notifyProductionUpdates: true,
        notifyCriticalAlerts: true,
      },
    });
  }

  /**
   * Persiste una notificación para un usuario puntual. Reusable desde
   * cualquier servicio que hoy emita un evento en vivo por WebSocket
   * (ej. `OrderService`), para que la notificación no se pierda si el
   * destinatario no tiene sesión abierta en ese momento.
   *
   * Además del persist, dispara el Web Push real (Fase 3): mismo punto de
   * decisión de "a quién notificar" que ya usa todo `OrderService`, así no
   * se duplica esa lógica en cada call site. Antes de hacer cualquiera de
   * las dos cosas, respeta las preferencias de notificación del usuario
   * (ver `shouldNotify`).
   */
  async createNotification(input: CreateNotificationInput) {
    const prefs = await this.getNotificationPreferences(input.userId);
    if (!this.shouldNotify(prefs, input.type)) {
      return null;
    }

    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        orderId: input.orderId,
      },
    });
    void this.pushService.notifyUser(input.userId, {
      title: input.title,
      body: input.body,
      orderId: input.orderId,
    });
    void this.expoPushService.notifyUser(input.userId, {
      title: input.title,
      body: input.body,
      orderId: input.orderId,
    });
    return notification;
  }

  /**
   * Igual que `createNotification`, pero para varios destinatarios a la vez
   * (ej. todos los usuarios de un área cuando el pedido queda sin asignar).
   * Cada destinatario se filtra según sus propias preferencias.
   */
  async createNotificationForUsers(
    userIds: number[],
    input: Omit<CreateNotificationInput, 'userId'>,
  ) {
    if (userIds.length === 0) {
      return;
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        notificationsMuted: true,
        notifyMentionsOnly: true,
        notifyProductionUpdates: true,
        notifyCriticalAlerts: true,
      },
    });
    const prefsByUserId = new Map(users.map((u) => [u.id, u]));
    const recipientIds = userIds.filter((userId) =>
      this.shouldNotify(prefsByUserId.get(userId), input.type),
    );
    if (recipientIds.length === 0) {
      return;
    }

    await this.prisma.notification.createMany({
      data: recipientIds.map((userId) => ({
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        orderId: input.orderId,
      })),
    });
    void this.pushService.notifyUsers(recipientIds, {
      title: input.title,
      body: input.body,
      orderId: input.orderId,
    });
    void this.expoPushService.notifyUsers(recipientIds, {
      title: input.title,
      body: input.body,
      orderId: input.orderId,
    });
  }

  /**
   * Ids de todos los usuarios con un rol/área determinado. Mismo criterio
   * que usa `NotificationsGateway.notifyNewOrderToArea` (room = nombre del
   * rol/área), replicado acá para resolver destinatarios de la persistencia.
   */
  async userIdsForArea(area: string): Promise<number[]> {
    const users = await this.prisma.user.findMany({
      where: { roles: { some: { name: area } } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /** Notificaciones del usuario autenticado, más recientes primero. */
  async findAllForUser(userId: number, query?: PaginationQueryDto) {
    const { enabled, page, limit, skip } = resolvePagination(query);
    const where = { userId };

    if (!enabled) {
      return this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return buildPaginatedResult(data, total, page, limit);
  }

  /** Cantidad de notificaciones no leídas del usuario, para el badge de la campanita. */
  async unreadCount(userId: number): Promise<{ unreadCount: number }> {
    const unreadCount = await this.prisma.notification.count({
      where: { userId, read: false },
    });
    return { unreadCount };
  }

  /** Marca una notificación como leída. Solo el dueño puede marcarla. */
  async markAsRead(id: number, userId: number) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!notification) {
      throw new NotFoundException('Notificación no encontrada');
    }
    if (notification.userId !== userId) {
      throw new ForbiddenException('Sin acceso a esta notificación');
    }
    if (notification.read) {
      return notification;
    }
    return this.prisma.notification.update({
      where: { id },
      data: { read: true },
    });
  }

  /** Marca todas las notificaciones del usuario como leídas. */
  async markAllAsRead(userId: number) {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { message: 'Notificaciones marcadas como leídas' };
  }
}
