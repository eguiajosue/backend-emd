import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/notifications/notifications.module';

/**
 * Chat interno entre áreas. Reutiliza el `NotificationsGateway` existente
 * (mismo handshake JWT y mismas rooms `user:<id>`) en vez de levantar un
 * segundo servidor de WebSocket.
 */
@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
