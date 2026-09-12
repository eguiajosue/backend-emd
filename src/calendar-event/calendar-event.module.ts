import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from 'src/notification/notification.module';
import { CalendarEventController } from './calendar-event.controller';
import { CalendarEventService } from './calendar-event.service';
import { CalendarEventReminderService } from './calendar-event-reminder.service';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [CalendarEventController],
  providers: [CalendarEventService, CalendarEventReminderService],
})
export class CalendarEventModule {}
