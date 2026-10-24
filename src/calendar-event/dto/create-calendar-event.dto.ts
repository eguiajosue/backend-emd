import { CalendarEventCategory } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
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
import { IsAreaSlug } from 'src/area/is-area-slug.decorator';

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
   * Pedido vinculado, opcional. En un evento de categoría "instalacion"
   * dispara la creación automática de "Compra de materiales" una semana
   * antes (ver CalendarEventService.create); en uno de categoría "compras"
   * es lo que arma el checklist de la hoja de materiales de ese pedido.
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  orderId?: number;

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
   * Área de producción involucrada (slug de un área activa), independiente de
   * `category`: filtro adicional del calendario (ej. una "instalación" la
   * puede hacer Taller o Bordado, según el pedido).
   */
  @IsOptional()
  @IsAreaSlug()
  area?: string;

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
