import { PartialType } from '@nestjs/mapped-types';
import { CreateCalendarTaskDto } from './create-calendar-task.dto';

export class UpdateCalendarTaskDto extends PartialType(CreateCalendarTaskDto) {}
