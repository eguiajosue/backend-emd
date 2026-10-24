import { InventoryMovementType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  Max,
  Min,
} from 'class-validator';
import { IsAreaSlug } from 'src/area/is-area-slug.decorator';

/** Filtro por departamento (`?area=bordado`). Sin él: todos los que el usuario puede ver. */
export class InventoryAreaQueryDto {
  @IsOptional()
  @IsAreaSlug()
  area?: string;
}

/**
 * Bitácora global de movimientos: por departamento, usuario, artículo, tipo
 * y rango de fechas (`from`/`to` en ISO; `to` con sólo fecha incluye todo
 * ese día).
 */
export class InventoryMovementsQueryDto extends InventoryAreaQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  itemId?: number;

  @IsOptional()
  @IsEnum(InventoryMovementType)
  type?: InventoryMovementType;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
