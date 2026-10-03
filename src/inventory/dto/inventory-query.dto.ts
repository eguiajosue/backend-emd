import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { INVENTORY_AREAS } from '../inventory.constants';

/** Filtro por departamento (`?area=bordado`). Sin él: todos los que el usuario puede ver. */
export class InventoryAreaQueryDto {
  @IsOptional()
  @IsIn(INVENTORY_AREAS)
  area?: (typeof INVENTORY_AREAS)[number];
}

export class InventoryMovementsQueryDto extends InventoryAreaQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
