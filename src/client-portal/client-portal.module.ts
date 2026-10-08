import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationModule } from 'src/notification/notification.module';
import { ClientPortalService } from './client-portal.service';
import {
  ClientPortalController,
  ClientPortalStaffController,
} from './client-portal.controller';

/** Portal del cliente: enlace privado por pedido (WORKFLOW.md §8). */
@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [ClientPortalController, ClientPortalStaffController],
  providers: [ClientPortalService],
})
export class ClientPortalModule {}
