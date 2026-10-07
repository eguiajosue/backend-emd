import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';
import { EmptyToUndefined } from 'src/common/transformers/empty-to-undefined';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';

/**
 * Filtros del listado de clientes (además de la paginación opt-in). Sólo
 * los usa la matriz: la cuenta de sucursal los ignora y siempre ve los suyos.
 */
export class ClientListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Sólo clientes de esa sucursal' })
  @EmptyToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  branchId?: number;

  @ApiPropertyOptional({
    enum: ['matriz', 'sucursal'],
    description:
      'matriz = clientes sin sucursal; sucursal = los de cualquier sucursal',
  })
  @EmptyToUndefined()
  @IsOptional()
  @IsIn(['matriz', 'sucursal'])
  scope?: 'matriz' | 'sucursal';
}
