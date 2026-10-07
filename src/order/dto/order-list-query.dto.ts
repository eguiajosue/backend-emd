import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { EmptyToUndefined } from 'src/common/transformers/empty-to-undefined';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';

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
}
