import { Module } from '@nestjs/common';
import { NotificationsGateway } from './notifications.gateway';

@Module({
  imports: [],
  controllers: [],
  providers: [NotificationsGateway],
})
export class NotificationsModule {}
