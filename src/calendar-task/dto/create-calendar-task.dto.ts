import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  EmptyToUndefined,
  TrimString,
} from 'src/common/transformers/empty-to-undefined';

/**
 * Alta de una tarea pendiente del calendario de equipo: actividad sin fecha
 * todavía definida (ej. "Confirmar medidas con cliente"), separada de
 * `CalendarEvent`.
 */
export class CreateCalendarTaskDto {
  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** Pedido relacionado, opcional (ej. "confirmar medidas" de un pedido puntual). */
  @IsOptional()
  @IsInt()
  @IsPositive()
  orderId?: number;
}
