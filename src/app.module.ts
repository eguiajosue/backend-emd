import { Module } from '@nestjs/common';
import { CompaniesModule } from './companies/companies.module';
import { PrismaModule } from './prisma/prisma.module';
import { ClientsModule } from './clients/clients.module';
import { RolesModule } from './roles/roles.module';

@Module({
  imports: [CompaniesModule, PrismaModule, ClientsModule, RolesModule],
})
export class AppModule {}
