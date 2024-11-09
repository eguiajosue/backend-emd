import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';

@Module({
  imports: [PrismaModule],
  controllers: [OrderController],
  providers: [OrderService, NotificationsGateway],
})
export class OrderModule {}
