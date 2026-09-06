import {
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
  body: string;
  createdAt: Date;
  senderId: number;
  senderUsername: string;
  senderName: string;
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

  constructor(private readonly configService: ConfigService) {}

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    // El cliente manda el token de dos formas: `extraHeaders.authorization`
    // (sólo viaja con el transporte polling) y `auth.token` (el único que
    // llega cuando el navegador usa `transports: ["websocket"]`, porque el
    // WebSocket del browser no admite cabeceras propias). Se aceptan las dos.
    const authPayload = client.handshake.auth as { token?: unknown } | undefined;
    const token =
      (typeof authPayload?.token === 'string' ? authPayload.token : undefined) ??
      client.handshake.headers.authorization;

    if (!token) {
      this.logger.warn(`Client disconnected: No token provided`);
      client.disconnect();
      return;
    }

    try {
      const decoded = jwt.verify(
        token.replace('Bearer ', '').trim(),
        this.configService.get<string>('JWT_SECRET'),
      ) as jwt.JwtPayload & { sub: number; roles: string[]; username: string };

      const roles = decoded.roles ?? [];
      roles.forEach((role) => client.join(role));
      // Room individual por usuario, para notificaciones dirigidas
      // (ej. pedido asignado directamente a él).
      if (decoded.sub != null) {
        client.join(`user:${decoded.sub}`);
      }
      this.logger.log(
        `Client connected: ${decoded.username} with roles ${roles.join(', ')}`,
      );
    } catch (error) {
      this.logger.error(`Client disconnected: Invalid token`, error.message);
      client.disconnect();
      return;
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('newOrderNotification')
  notifyNewOrderToAdmin(@MessageBody() order: OrderNotificationPayload) {
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

  @SubscribeMessage('orderStatusChangeNotification')
  notifyOrderStatusChange(@MessageBody() order: OrderNotificationPayload) {
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
   * Nota agregada a un pedido: se notifica al usuario asignado (room
   * `user:${assignedUserId}`) si tiene uno, o al área del pedido (misma
   * room de rol/área que las notificaciones de pedido nuevo) en caso
   * contrario.
   */
  notifyOrderNoteAdded(
    target: { assignedUserId: number | null; area: string | null },
    note: OrderNoteNotificationPayload,
  ) {
    if (target.assignedUserId) {
      this.server
        .to(`user:${target.assignedUserId}`)
        .emit('orderNoteAdded', note);
    } else if (target.area) {
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
}
