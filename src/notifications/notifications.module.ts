import { Module } from '@nestjs/common';
import { NotificationsGateway } from './notifications.gateway';
import { RealtimeService } from './realtime.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [],
  providers: [NotificationsGateway, RealtimeService],
  exports: [NotificationsGateway],
})
export class NotificationsModule {}
