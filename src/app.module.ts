import { ClientPortalModule } from './client-portal/client-portal.module';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { CompanyModule } from './company/company.module';
import { ClientModule } from './client/client.module';
import { RoleModule } from './role/role.module';
import { UserModule } from './user/user.module';
import { StatusModule } from './status/status.module';
import { OrderModule } from './order/order.module';
import { OrderHistoryModule } from './order-history/order-history.module';
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
import { PushModule } from './push/push.module';
import { CalendarEventModule } from './calendar-event/calendar-event.module';
import { CalendarTaskModule } from './calendar-task/calendar-task.module';
import { SupplierModule } from './supplier/supplier.module';
import { MaterialCategoryModule } from './material-category/material-category.module';
import { MaterialUnitModule } from './material-unit/material-unit.module';
import { MaterialModule } from './material/material.module';
import { InventoryModule } from './inventory/inventory.module';
import { OrderTemplateModule } from './order-template/order-template.module';
import { ClientInsightModule } from './client-insight/client-insight.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { OrderMockupModule } from './order-mockup/order-mockup.module';
import { MockupTemplateModule } from './mockup-template/mockup-template.module';
import { MockupLogoModule } from './mockup-logo/mockup-logo.module';
import { QuoteModule } from './quote/quote.module';
import { BranchModule } from './branch/branch.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { validateEnv } from './config/env.validation';
import { AppController } from './app.controller';

@Module({
  imports: [
    // Primero, como pide la guía de Sentry para Nest: nombra las transacciones
    // por ruta. Sin SENTRY_DSN (Sentry.init no corrió) no hace nada.
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
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
    StorageModule,
    CompanyModule,
    ClientModule,
    RoleModule,
    UserModule,
    StatusModule,
    OrderModule,
    OrderHistoryModule,
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
    PushModule,
    CalendarEventModule,
    CalendarTaskModule,
    SupplierModule,
    MaterialCategoryModule,
    MaterialUnitModule,
    MaterialModule,
    InventoryModule,
    OrderTemplateModule,
    ClientInsightModule,
    DashboardModule,
    OrderMockupModule,
    MockupTemplateModule,
    MockupLogoModule,
    QuoteModule,
    BranchModule,
    ClientPortalModule,
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
    // Express 5 (path-to-regexp v8) exige wildcards con nombre: `{*splat}`
    // matchea todas las rutas, incluida la raíz.
    consumer.apply(RequestIdMiddleware).forRoutes('{*splat}');
  }
}
