import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import {
  EmptyToUndefined,
  TrimString,
} from 'src/common/transformers/empty-to-undefined';

/**
 * Búsqueda y filtros del Historial de pedidos (sobre la paginación de
 * siempre). Todos opcionales y combinables.
 */
export class OrderHistoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Texto libre: código ("EMD-P0042", "42"), cliente, empresa o descripción',
  })
  @TrimString()
  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional()
  @EmptyToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  statusId?: number;

  @ApiPropertyOptional()
  @EmptyToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  clientId?: number;

  @ApiPropertyOptional({
    description: 'Área actual del pedido o de alguna de sus tareas',
  })
  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  area?: string;

  @ApiPropertyOptional({ description: 'Fecha de creación desde (ISO)' })
  @EmptyToUndefined()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Fecha de creación hasta (ISO)' })
  @EmptyToUndefined()
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Fecha de entrega desde (ISO)' })
  @EmptyToUndefined()
  @IsOptional()
  @IsDateString()
  deliveryFrom?: string;

  @ApiPropertyOptional({ description: 'Fecha de entrega hasta (ISO)' })
  @EmptyToUndefined()
  @IsOptional()
  @IsDateString()
  deliveryTo?: string;
}
