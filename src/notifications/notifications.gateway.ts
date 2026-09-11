import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildCorsOriginCallback,
  parseAllowedOrigins,
} from '../common/cors-origin';
import { PrismaService } from '../prisma/prisma.service';

interface OrderNotificationPayload {
  id: number | string;
  clientName?: string;
  createdBy?: string;
  status?: string;
}

/** Payload de las notificaciones dirigidas (por usuario o por área) de un pedido nuevo. */
interface TargetedOrderNotificationPayload {
  orderId: number;
  description: string;
  area: string | null;
  deliveryDate: Date | null;
  clientName?: string;
  /**
   * Motivo del aviso. Sin esto el cliente no puede distinguir un pedido recién
   * asignado de un montaje enviado y titula los dos igual ("Nuevo pedido
   * asignado"), que es falso para el segundo. Ausente = pedido asignado.
   */
  reason?: 'order_assigned' | 'design_montage_sent';
}

/** Payload de la notificación de nota agregada a un pedido. */
interface OrderNoteNotificationPayload {
  orderId: number;
  noteId: number;
  text: string;
  authorUsername: string;
  createdAt: Date;
}

/** Payload de la notificación específica a Recepción por cambio de estado de un pedido. */
export interface OrderStatusChangedPayload {
  orderId: number;
  changedByUsername: string;
  previousStatus: string;
  newStatus: string;
  changedAt: Date;
}

/** Payload de un mensaje de chat entregado en vivo. */
interface ChatMessagePayload {
  id: number;
  conversationId: number;
  body: string | null;
  createdAt: Date;
  senderId: number;
  senderUsername: string;
  senderName: string;
  /** Pedido opcional adjuntado al mensaje como contexto (ver ChatService.sendMessage). */
  orderId?: number | null;
  order?: {
    id: number;
    description: string;
    area: string | null;
    status: { name: string } | null;
  } | null;
  /** Adjunto opcional (foto, documento o audio) -- ver ChatService.toAttachmentDto. */
  attachment?: {
    filename: string;
    mimeType: string;
    size: number | null;
    dataUrl?: string;
  } | null;
}

/** Payload de la notificación genérica a Recepción por cambios de un usuario de área. */
interface AreaUserUpdatedOrderPayload {
  orderId: number;
  updatedByUsername: string;
  summary: string;
}

// El decorador se evalúa al cargar el módulo, antes de que exista el
// ConfigService inyectable, por eso leemos process.env directamente acá
// (mismo valor que consume ConfigService, con el mismo default).
@WebSocketGateway({
  cors: {
    origin: buildCorsOriginCallback(
      parseAllowedOrigins(process.env.FRONTEND_URL || 'http://localhost:3000'),
    ),
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger: Logger = new Logger('NotificationsGateway');

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');
  }

  async handleConnection(client: Socket) {
    // El cliente manda el token de dos formas: `extraHeaders.authorization`
    // (sólo viaja con el transporte polling) y `auth.token` (el único que
    // llega cuando el navegador usa `transports: ["websocket"]`, porque el
    // WebSocket del browser no admite cabeceras propias). Se aceptan las dos.
    const authPayload = client.handshake.auth as
      | { token?: unknown }
      | undefined;
    const token =
      (typeof authPayload?.token === 'string'
        ? authPayload.token
        : undefined) ?? client.handshake.headers.authorization;

    if (!token) {
      this.logger.warn(`Client disconnected: No token provided`);
      client.disconnect();
      return;
    }

    try {
      const decoded = jwt.verify(
        token.replace('Bearer ', '').trim(),
        this.configService.get<string>('JWT_SECRET'),
      ) as jwt.JwtPayload & {
        sub: number;
        roles: string[];
        username: string;
        type?: string;
      };

      // Mismo criterio que AuthGuard: un refresh token es sólo para canjear
      // por un access token, no habilita sesión (acá equivaldría a un canal
      // de notificaciones que sobrevive 7 días a cualquier revocación).
      if (decoded.type === 'refresh') {
        this.logger.warn('Client disconnected: refresh token no habilitado');
        client.disconnect();
        return;
      }

      const roles = decoded.roles ?? [];
      roles.forEach((role) => client.join(role));
      // Room individual por usuario, para notificaciones dirigidas
      // (ej. pedido asignado directamente a él).
      if (decoded.sub != null) {
        client.join(`user:${decoded.sub}`);
        client.data.userId = decoded.sub;
      }
      this.logger.log(
        `Client connected: ${decoded.username} with roles ${roles.join(', ')}`,
      );

      // Sólo el PRIMER socket vivo de este usuario dispara "en línea": si ya
      // tenía otra pestaña conectada, no hace falta volver a avisar.
      const room = this.server.sockets.adapter.rooms.get(`user:${decoded.sub}`);
      if (room && room.size === 1) {
        this.server.emit('presenceChanged', {
          userId: decoded.sub,
          online: true,
          lastSeenAt: null,
        });
      }
    } catch (error) {
      this.logger.error(`Client disconnected: Invalid token`, error.message);
      client.disconnect();
      return;
    }
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);

    const userId = client.data?.userId as number | undefined;
    if (userId == null) return;

    // Socket.io ya sacó a este cliente de sus rooms en este punto: si la
    // room del usuario queda vacía, era su último socket vivo.
    const room = this.server.sockets.adapter.rooms.get(`user:${userId}`);
    if (room && room.size > 0) return;

    const lastSeenAt = new Date();
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { lastSeenAt },
      });
    } catch (error) {
      // Igual que el resto del gateway: un fallo acá no debe tirar la
      // desconexión. Se loguea y se sigue.
      this.logger.error(
        `No se pudo guardar lastSeenAt para el usuario ${userId}`,
        error.message,
      );
    }
    this.server.emit('presenceChanged', { userId, online: false, lastSeenAt });
  }

  /**
   * Sin `@SubscribeMessage`: este método lo llama SOLO el servidor
   * (`OrderService.create`). Estando suscrito, cualquier cliente conectado
   * podía emitir `newOrderNotification` y hacer que el backend le reenviara a
   * la room `admin` una notificación de un pedido inventado.
   */
  notifyNewOrderToAdmin(order: OrderNotificationPayload) {
    this.logger.debug('Order data received for notification:', order);

    if (order && order.id && order.clientName && order.createdBy) {
      this.server.to('admin').emit('newOrderNotification', order);
      this.logger.log(`Notification sent to admin: Order ID ${order.id}`);
    } else {
      this.logger.warn('Invalid order data received for notification', order);
    }
  }

  /**
   * Pedido creado con `assignedUserId`: notificación dirigida SOLO a ese
   * usuario, a través de su room individual (`user:${userId}`, unida en
   * `handleConnection`). No pisa la notificación existente al admin.
   */
  notifyNewAssignedOrder(
    userId: number,
    order: TargetedOrderNotificationPayload,
  ) {
    this.server
      .to(`user:${userId}`)
      .emit('newAssignedOrderNotification', order);
    this.logger.log(
      `Assigned order notification sent to user ${userId}: Order ID ${order.orderId}`,
    );
  }

  /**
   * Pedido creado SIN `assignedUserId`: queda disponible para cualquiera del
   * área, se notifica a la room de rol/área correspondiente (las rooms de
   * rol ya se unen 1:1 con el nombre del área en `handleConnection`).
   * Reutiliza el evento `newOrderNotification` existente.
   */
  notifyNewOrderToArea(area: string, order: TargetedOrderNotificationPayload) {
    this.server.to(area).emit('newOrderNotification', order);
    this.logger.log(
      `New order notification sent to area "${area}": Order ID ${order.orderId}`,
    );
  }

  /**
   * Igual que `notifyNewOrderToAdmin`: emisor server-side
   * (`OrderService.update`). Suscrito era peor todavía, porque el reenvío es
   * un broadcast a TODOS los clientes.
   */
  notifyOrderStatusChange(order: OrderNotificationPayload) {
    if (order && order.id && order.status) {
      this.server.emit('orderStatusChangeNotification', order);
      this.logger.log(
        `Order status change notification sent: Order ID ${order.id}, Status ${order.status}`,
      );
    } else {
      this.logger.warn(
        'Invalid order data received for status change notification',
      );
    }
  }

  /**
   * Nota agregada a un pedido: sólo se notifica al área del pedido (misma
   * room de rol/área que las notificaciones de pedido nuevo) cuando el
   * pedido NO tiene usuario asignado todavía. Un usuario de área operativa
   * ya asignado a un pedido no recibe esta notificación — según la regla de
   * negocio, sólo se le notifica cuando se le asigna un pedido nuevo, no en
   * cambios posteriores (notas incluidas) sobre pedidos que ya tiene
   * asignados.
   */
  notifyOrderNoteAdded(
    target: { assignedUserId: number | null; area: string | null },
    note: OrderNoteNotificationPayload,
  ) {
    if (!target.assignedUserId && target.area) {
      this.server.to(target.area).emit('orderNoteAdded', note);
    }
    this.logger.log(`Note notification sent: Order ID ${note.orderId}`);
  }

  /**
   * Notificación genérica a Recepción cuando un usuario de un área
   * operativa modifica un campo relevante de un pedido (status manual,
   * descripción, fecha de entrega, asignación). No reemplaza las
   * notificaciones puntuales del flujo de diseño (montaje/feedback/
   * autorizado), que mantienen sus propios eventos.
   */
  notifyAreaUserUpdatedOrder(payload: AreaUserUpdatedOrderPayload) {
    this.server.to('recepcion').emit('areaUserUpdatedOrder', payload);
    this.logger.log(
      `Area user update notification sent to recepcion: Order ID ${payload.orderId}`,
    );
  }

  /**
   * Cambio de estado de un pedido, con su propio evento/tipo para que el
   * panel de notificaciones lo muestre con una etiqueta distinguible
   * ("Cambio de estado"). Se emite a Recepción (misma room que
   * `notifyAreaUserUpdatedOrder`) y al usuario asignado, si lo hay.
   */
  notifyOrderStatusChangedToRecepcion(payload: OrderStatusChangedPayload) {
    this.server.to('recepcion').emit('orderStatusChanged', payload);
    this.logger.log(
      `Order status change notification sent to recepcion: Order ID ${payload.orderId} (${payload.previousStatus} -> ${payload.newStatus})`,
    );
  }

  /**
   * Verifica que `userId` sea miembro de `conversationId` antes de dejarlo
   * disparar un evento en tiempo real hacia esa conversación. Nunca se
   * confía en el `conversationId` que manda el cliente sin esta validación
   * server-side.
   */
  private async isConversationMember(
    conversationId: number,
    userId: number,
  ): Promise<boolean> {
    if (!Number.isInteger(conversationId) || !Number.isInteger(userId)) {
      return false;
    }
    const membership = await this.prisma.chatConversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    return !!membership;
  }

  /**
   * El cliente confirma haber recibido un mensaje de una conversación
   * (dispara al recibir `chatMessage`). Actualiza `deliveredAt` de SU PROPIA
   * membresía y avisa a los demás miembros para que actualicen el check de
   * entrega de sus mensajes salientes.
   */
  @SubscribeMessage('chatDelivered')
  async handleChatDelivered(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: number },
  ) {
    const userId = client.data?.userId as number | undefined;
    const conversationId = body?.conversationId;
    if (userId == null || conversationId == null) return;
    if (!(await this.isConversationMember(conversationId, userId))) return;

    const deliveredAt = new Date();
    await this.prisma.chatConversationMember.updateMany({
      where: { conversationId, userId },
      data: { deliveredAt },
    });

    const others = await this.prisma.chatConversationMember.findMany({
      where: { conversationId, userId: { not: userId } },
      select: { userId: true },
    });
    others.forEach(({ userId: otherId }) => {
      this.server
        .to(`user:${otherId}`)
        .emit('chatDelivered', { conversationId, userId, deliveredAt });
    });
  }

  @SubscribeMessage('chatTyping')
  async handleChatTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: number },
  ) {
    await this.relayTypingEvent('chatTyping', client, body);
  }

  @SubscribeMessage('chatStopTyping')
  async handleChatStopTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: number },
  ) {
    await this.relayTypingEvent('chatStopTyping', client, body);
  }

  private async relayTypingEvent(
    event: 'chatTyping' | 'chatStopTyping',
    client: Socket,
    body: { conversationId?: number },
  ) {
    const userId = client.data?.userId as number | undefined;
    const conversationId = body?.conversationId;
    if (userId == null || conversationId == null) return;
    if (!(await this.isConversationMember(conversationId, userId))) return;

    const others = await this.prisma.chatConversationMember.findMany({
      where: { conversationId, userId: { not: userId } },
      select: { userId: true },
    });
    others.forEach(({ userId: otherId }) => {
      this.server.to(`user:${otherId}`).emit(event, { conversationId, userId });
    });
  }

  /**
   * Mensaje de chat en vivo. Los destinatarios los calcula `ChatService` en
   * el servidor a partir de la membresía de la conversación (nunca del
   * cliente), y se emiten a la room individual `user:<id>` que cada cliente
   * une en `handleConnection` tras validar su JWT: por eso no hace falta —
   * ni se permite — que el cliente se una a rooms de conversación.
   */
  emitChatMessage(userIds: number[], message: ChatMessagePayload) {
    userIds.forEach((userId) => {
      this.server.to(`user:${userId}`).emit('chatMessage', message);
    });
    this.logger.log(
      `Chat message ${message.id} emitted to ${userIds.length} member(s) of conversation ${message.conversationId}`,
    );
  }

  /**
   * Alguien marcó la conversación como leída: se avisa a los DEMÁS
   * miembros (no al que la marcó) para que actualicen el check de lectura
   * de sus propios mensajes en tiempo real.
   */
  emitChatRead(
    userIds: number[],
    payload: { conversationId: number; userId: number; lastReadAt: Date },
  ) {
    userIds.forEach((userId) => {
      this.server.to(`user:${userId}`).emit('chatRead', payload);
    });
  }

  /**
   * true si el usuario tiene al menos un socket vivo en su room individual.
   * `this.server` puede no estar listo en tests unitarios que instancian el
   * gateway sin levantar un servidor real — se devuelve `false` en ese caso
   * en vez de tirar.
   */
  isUserOnline(userId: number): boolean {
    const room = this.server?.sockets?.adapter?.rooms?.get(`user:${userId}`);
    return !!room && room.size > 0;
  }
}
