import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { EmptyToUndefined } from 'src/common/transformers/empty-to-undefined';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';

/** Origen del pedido: de la matriz (sin sucursal) o de alguna sucursal. */
export const ORDER_ORIGINS = ['matriz', 'sucursal'] as const;
export type OrderOrigin = (typeof ORDER_ORIGINS)[number];

/**
 * Filtros opcionales de `GET /orders` (además de la paginación opt-in). Se
 * aplican SIEMPRE por encima de la visibilidad del rol (AND), así que nunca
 * amplían lo que el usuario puede ver. Pensados para el historial de la
 * cuenta de sucursal, pero valen para cualquier rol.
 */
export class OrderListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Búsqueda por id del pedido, cliente (nombre/empresa/nombre libre) o descripción',
  })
  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Estado del pedido' })
  @EmptyToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  statusId?: number;

  @ApiPropertyOptional({ description: 'Fecha de creación desde (ISO)' })
  @EmptyToUndefined()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Fecha de creación hasta (ISO)' })
  @EmptyToUndefined()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description:
      'Sólo pedidos de esa sucursal. Lo aplica únicamente la matriz; la cuenta de sucursal lo ignora (siempre ve sólo la suya).',
  })
  // Vacío = ausente (el Type de class-transformer lo volvería 0); un valor no
  // numérico queda NaN y `@IsInt` lo rechaza con 400.
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === ''
      ? undefined
      : Number(value),
  )
  @IsOptional()
  @IsInt()
  branchId?: number;

  @ApiPropertyOptional({
    enum: ORDER_ORIGINS,
    description:
      '"matriz" = pedidos sin sucursal; "sucursal" = pedidos de cualquier sucursal. Lo aplica únicamente la matriz; la cuenta de sucursal lo ignora.',
  })
  @EmptyToUndefined()
  @IsOptional()
  @IsIn(ORDER_ORIGINS)
  origin?: OrderOrigin;
}
