import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ClientInsightModule } from 'src/client-insight/client-insight.module';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [PrismaModule, ClientInsightModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
