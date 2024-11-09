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

@WebSocketGateway({
  cors: {
    origin: '*', // Configurar correctamente según tu entorno
  },
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger: Logger = new Logger('NotificationsGateway');

  afterInit(server: Server) {
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
        process.env.JWT_SECRET,
      ) as jwt.JwtPayload & { role: { name: string }; username: string };

      client.join(decoded.role.name);
      this.logger.log(
        `Client connected: ${decoded.username} with role ${decoded.role.name}`,
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
  notifyNewOrderToAdmin(@MessageBody() order: any) {
    this.logger.debug('Order data received for notification:', order);

    if (order && order.id && order.clientName && order.createdBy) {
      this.server.to('admin').emit('newOrderNotification', order);
      this.logger.log(`Notification sent to admin: Order ID ${order.id}`);
    } else {
      this.logger.warn('Invalid order data received for notification', order);
    }
  }

  @SubscribeMessage('orderStatusChangeNotification')
  notifyOrderStatusChange(@MessageBody() order: any) {
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
