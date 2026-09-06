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
    const token = client.handshake.headers.authorization;

    if (!token) {
      this.logger.warn(`Client disconnected: No token provided`);
      client.disconnect();
      return;
    }

    try {
      const decoded = jwt.verify(
        token.replace('Bearer ', '').trim(),
        this.configService.get<string>('JWT_SECRET'),
      ) as jwt.JwtPayload & { roles: string[]; username: string };

      const roles = decoded.roles ?? [];
      roles.forEach((role) => client.join(role));
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
}
