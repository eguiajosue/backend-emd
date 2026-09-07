import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { OrderModule } from 'src/order/order.module';

/**
 * Chat interno entre áreas. Reutiliza el `NotificationsGateway` existente
 * (mismo handshake JWT y mismas rooms `user:<id>`) en vez de levantar un
 * segundo servidor de WebSocket. Importa `OrderModule` para validar, al
 * adjuntar un pedido a un mensaje, que quien lo adjunta realmente tenga
 * acceso a ese pedido (mismo criterio que `GET /orders/:id`).
 */
@Module({
  imports: [PrismaModule, NotificationsModule, OrderModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
