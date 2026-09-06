import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { AreaVisibilityModule } from 'src/area-visibility/area-visibility.module';

@Module({
  imports: [PrismaModule, AreaVisibilityModule],
  controllers: [OrderController],
  providers: [OrderService, NotificationsGateway],
})
export class OrderModule {}
