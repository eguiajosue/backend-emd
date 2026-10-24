import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  TrimString,
  TrimStringList,
} from 'src/common/transformers/empty-to-undefined';
import { AREA_ICONS } from '../area-icons';
import {
  AREA_COLOR_PATTERN,
  AREA_NAME_MAX_LENGTH,
  AREA_NAME_MIN_LENGTH,
  MAX_INVENTORY_SUGGESTIONS,
  MAX_INVENTORY_SUGGESTION_LENGTH,
} from './create-area.dto';

/**
 * Edición de un área (PATCH /areas/:id). El slug no cambia nunca: es lo que
 * guardan pedidos, tareas e inventario.
 */
export class UpdateAreaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MinLength(AREA_NAME_MIN_LENGTH)
  @MaxLength(AREA_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ enum: AREA_ICONS })
  @IsOptional()
  @IsIn(AREA_ICONS)
  icon?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(AREA_COLOR_PATTERN, { message: 'color debe ser #rrggbb' })
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isProductionDestination?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasInventory?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  generalViewEnabled?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @TrimStringList()
  @IsArray()
  @ArrayMaxSize(MAX_INVENTORY_SUGGESTIONS)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(MAX_INVENTORY_SUGGESTION_LENGTH, { each: true })
  inventoryCategories?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @TrimStringList()
  @IsArray()
  @ArrayMaxSize(MAX_INVENTORY_SUGGESTIONS)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(MAX_INVENTORY_SUGGESTION_LENGTH, { each: true })
  inventoryUnits?: string[];

  /** Desactivar un área no la borra: se conservan pedidos, tareas e inventario. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
