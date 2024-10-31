import { Module } from '@nestjs/common';
import { OrderHistoryService } from './order_history.service';
import { OrderHistoryController } from './order_history.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [OrderHistoryController],
  providers: [OrderHistoryService],
})
export class OrderHistoryModule {}
