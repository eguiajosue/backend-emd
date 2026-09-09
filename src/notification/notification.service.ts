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

/** Datos necesarios para crear una notificación persistente. */
export interface CreateNotificationInput {
  userId: number;
  type: string;
  title: string;
  body?: string;
  orderId?: number;
}

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
  ) {}

  /**
   * Persiste una notificación para un usuario puntual. Reusable desde
   * cualquier servicio que hoy emita un evento en vivo por WebSocket
   * (ej. `OrderService`), para que la notificación no se pierda si el
   * destinatario no tiene sesión abierta en ese momento.
   *
   * Además del persist, dispara el Web Push real (Fase 3): mismo punto de
   * decisión de "a quién notificar" que ya usa todo `OrderService`, así no
   * se duplica esa lógica en cada call site.
   * // TODO Fase 4: respetar notificationsMuted / filtros antes de emitir.
   */
  async createNotification(input: CreateNotificationInput) {
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
    return notification;
  }

  /**
   * Igual que `createNotification`, pero para varios destinatarios a la vez
   * (ej. todos los usuarios de un área cuando el pedido queda sin asignar).
   */
  async createNotificationForUsers(
    userIds: number[],
    input: Omit<CreateNotificationInput, 'userId'>,
  ) {
    if (userIds.length === 0) {
      return;
    }
    await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        orderId: input.orderId,
      })),
    });
    void this.pushService.notifyUsers(userIds, {
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
