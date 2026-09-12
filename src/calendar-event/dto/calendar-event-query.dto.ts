import { IsDateString, IsOptional } from 'class-validator';

/** Filtro de rango para listar el calendario (ej. el mes visible en pantalla). */
export class CalendarEventQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
