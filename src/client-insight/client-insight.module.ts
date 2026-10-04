import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ClientInsightService } from './client-insight.service';
import { ClientInsightController } from './client-insight.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ClientInsightController],
  providers: [ClientInsightService],
  exports: [ClientInsightService],
})
export class ClientInsightModule {}
