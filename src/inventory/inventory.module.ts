import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationModule } from 'src/notification/notification.module';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
