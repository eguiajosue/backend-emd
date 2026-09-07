import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { CompanyModule } from './company/company.module';
import { ClientModule } from './client/client.module';
import { RoleModule } from './role/role.module';
import { UserModule } from './user/user.module';
import { StatusModule } from './status/status.module';
import { OrderModule } from './order/order.module';
import { OrderHistoryModule } from './order-history/order-history.module';
import { ProductTypeModule } from './product-type/product-type.module';
import { ColorModule } from './color/color.module';
import { SizeModule } from './size/size.module';
import { ProductModule } from './product/product.module';
import { InventoryTransactionModule } from './inventory-transaction/inventory-transaction.module';
import { OrderProductModule } from './order-product/order-product.module';
import { LogModule } from './log/log.module';
import { AuthModule } from './auth/auth.module';
import { NotificationsModule } from './notifications/notifications.module';
import { NotificationModule } from './notification/notification.module';
import { HealthModule } from './health/health.module';
import { AreaVisibilityModule } from './area-visibility/area-visibility.module';
import { OrderProductPresetModule } from './order-product-preset/order-product-preset.module';
import { PerformanceModule } from './performance/performance.module';
import { BugReportModule } from './bug-report/bug-report.module';
import { SettingsModule } from './settings/settings.module';
import { ChatModule } from './chat/chat.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { validateEnv } from './config/env.validation';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('THROTTLE_TTL'),
          limit: config.get<number>('THROTTLE_LIMIT'),
        },
      ],
    }),
    PrismaModule,
    CompanyModule,
    ClientModule,
    RoleModule,
    UserModule,
    StatusModule,
    OrderModule,
    OrderHistoryModule,
    ProductTypeModule,
    ColorModule,
    SizeModule,
    ProductModule,
    InventoryTransactionModule,
    OrderProductModule,
    LogModule,
    AuthModule,
    NotificationsModule,
    NotificationModule,
    HealthModule,
    AreaVisibilityModule,
    OrderProductPresetModule,
    PerformanceModule,
    BugReportModule,
    SettingsModule,
    ChatModule,
    AuditLogModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
