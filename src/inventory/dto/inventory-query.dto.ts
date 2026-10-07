import { InventoryMovementType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  Max,
  Min,
} from 'class-validator';
import { INVENTORY_AREAS } from '../inventory.constants';

/** Filtro por departamento (`?area=bordado`). Sin él: todos los que el usuario puede ver. */
export class InventoryAreaQueryDto {
  @IsOptional()
  @IsIn(INVENTORY_AREAS)
  area?: (typeof INVENTORY_AREAS)[number];
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
