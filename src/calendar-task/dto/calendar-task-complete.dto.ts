import { IsBoolean } from 'class-validator';

/** Marca (o desmarca) una tarea como completada. */
export class UpdateCalendarTaskCompleteDto {
  @IsBoolean()
  completed: boolean;
}
