import { AreaTaskStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

/** Avance de un evento: pendiente → en_proceso → terminado. */
export class UpdateCalendarEventStatusDto {
  @IsEnum(AreaTaskStatus)
  status: AreaTaskStatus;
}
