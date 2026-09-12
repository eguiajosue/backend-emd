import { CalendarEventCategory } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EmptyToUndefined,
  TrimString,
} from 'src/common/transformers/empty-to-undefined';
import { ORDER_AREAS } from 'src/order/dto/create-order.dto';

/**
 * Alta de un evento del calendario de equipo de Recepción (instalaciones,
 * juntas, visitas a clientes — lo que hoy se coordina a mano por WhatsApp).
 */
export class CreateCalendarEventDto {
  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  title: string;

  /** Cliente/empresa escrito a mano, igual que hoy en WhatsApp ("MEDLINE", "HUDSON"). */
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(200)
  clientName?: string;

  /** Cliente real vinculado, si se eligió de la lista en vez de texto libre. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  clientId?: number;

  /**
   * Categoría del evento (instalación/visita/entrega/junta/otro): define su
   * color en el calendario y si el frontend le muestra seguimiento de
   * estado (una junta no tiene "pendiente"/"terminado"). Default 'otro' si
   * no se manda.
   */
  @IsOptional()
  @IsEnum(CalendarEventCategory)
  category?: CalendarEventCategory;

  /**
   * Área de producción involucrada (uno de ORDER_AREAS), independiente de
   * `category`: filtro adicional del calendario (ej. una "instalación" la
   * puede hacer Taller o Bordado, según el pedido).
   */
  @IsOptional()
  @IsIn(ORDER_AREAS)
  area?: (typeof ORDER_AREAS)[number];

  /** Fecha (y hora, si `hasTime`) del evento, en ISO 8601. */
  @IsDateString()
  eventDate: string;

  /** Si `eventDate` lleva una hora real (`false` = evento "todo el día"). */
  @IsOptional()
  @IsBoolean()
  hasTime?: boolean;

  /**
   * Anticipación (en minutos) del recordatorio push que pidió el usuario,
   * además del aviso fijo de 1h antes que siempre se manda
   * (CalendarEventReminderService). Puede representar minutos, horas, días
   * o semanas: el frontend lo normaliza a minutos antes de mandarlo.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  reminderMinutesBefore?: number;
}
