import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderAreaTaskService } from './order-area-task.service';
import { OrderMaterialItemService } from './order-material-item.service';
import { OrderController } from './order.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { AreaVisibilityModule } from 'src/area-visibility/area-visibility.module';
import { OrderProductPresetModule } from 'src/order-product-preset/order-product-preset.module';
import { NotificationModule } from 'src/notification/notification.module';
import { AuditLogModule } from 'src/audit-log/audit-log.module';
import { ProductionFileController } from './production-files/production-file.controller';
import { ProductionFileService } from './production-files/production-file.service';
import { CalendarEventModule } from 'src/calendar-event/calendar-event.module';

@Module({
  imports: [
    PrismaModule,
    AreaVisibilityModule,
    OrderProductPresetModule,
    NotificationModule,
    AuditLogModule,
    CalendarEventModule,
  ],
  controllers: [OrderController, ProductionFileController],
  providers: [
    OrderService,
    OrderAreaTaskService,
    OrderMaterialItemService,
    ProductionFileService,
    NotificationsGateway,
  ],
  exports: [OrderService, OrderAreaTaskService, OrderMaterialItemService],
})
export class OrderModule {}
