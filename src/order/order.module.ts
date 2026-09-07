import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderAreaTaskService } from './order-area-task.service';
import { OrderController } from './order.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { AreaVisibilityModule } from 'src/area-visibility/area-visibility.module';
import { OrderProductPresetModule } from 'src/order-product-preset/order-product-preset.module';
import { NotificationModule } from 'src/notification/notification.module';
import { AuditLogModule } from 'src/audit-log/audit-log.module';

@Module({
  imports: [
    PrismaModule,
    AreaVisibilityModule,
    OrderProductPresetModule,
    NotificationModule,
    AuditLogModule,
  ],
  controllers: [OrderController],
  providers: [OrderService, OrderAreaTaskService, NotificationsGateway],
  exports: [OrderService, OrderAreaTaskService],
})
export class OrderModule {}
