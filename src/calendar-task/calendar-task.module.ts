import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CalendarTaskController } from './calendar-task.controller';
import { CalendarTaskService } from './calendar-task.service';

@Module({
  imports: [PrismaModule],
  controllers: [CalendarTaskController],
  providers: [CalendarTaskService],
})
export class CalendarTaskModule {}
