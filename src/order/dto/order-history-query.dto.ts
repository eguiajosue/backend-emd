import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString } from 'class-validator';
import { EmptyToUndefined } from 'src/common/transformers/empty-to-undefined';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';

/** Filtros del historial de pedidos (además de la paginación). */
export class OrderHistoryQueryDto extends PaginationQueryDto {
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
