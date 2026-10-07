import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import { EmptyToUndefined } from 'src/common/transformers/empty-to-undefined';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { ORDER_ORIGINS, type OrderOrigin } from './order-list-query.dto';

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

  @ApiPropertyOptional({
    description:
      'Sólo pedidos de esa sucursal. Lo aplica únicamente la matriz; la cuenta de sucursal lo ignora (siempre ve sólo la suya).',
  })
  // Vacío = ausente; un valor no numérico queda NaN y `@IsInt` lo rechaza (400).
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
