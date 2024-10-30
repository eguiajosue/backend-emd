import { Module } from '@nestjs/common';
import { CompaniesModule } from './companies/companies.module';
import { PrismaModule } from './prisma/prisma.module';
import { ClientsModule } from './clients/clients.module';
import { RolesModule } from './roles/roles.module';
import { UsersModule } from './users/users.module';
import { OrdersModule } from './orders/orders.module';
import { OrderHistoryModule } from './order_history/order_history.module';

@Module({
  imports: [CompaniesModule, PrismaModule, ClientsModule, RolesModule, UsersModule, OrdersModule, OrderHistoryModule],
})
export class AppModule {}
