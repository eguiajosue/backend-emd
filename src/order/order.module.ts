import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { AreaVisibilityModule } from 'src/area-visibility/area-visibility.module';
import { OrderProductPresetModule } from 'src/order-product-preset/order-product-preset.module';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [
    PrismaModule,
    AreaVisibilityModule,
    OrderProductPresetModule,
    NotificationModule,
  ],
  controllers: [OrderController],
  providers: [OrderService, NotificationsGateway],
  exports: [OrderService],
})
export class OrderModule {}
