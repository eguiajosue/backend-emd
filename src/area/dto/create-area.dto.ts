import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
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

export const AREA_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const AREA_NAME_MIN_LENGTH = 2;
export const AREA_NAME_MAX_LENGTH = 40;
export const MAX_INVENTORY_SUGGESTIONS = 20;
export const MAX_INVENTORY_SUGGESTION_LENGTH = 40;

/** Alta de un área desde el wizard (POST /areas). */
export class CreateAreaDto {
  @ApiProperty({ example: 'Impresión 3D' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MinLength(AREA_NAME_MIN_LENGTH)
  @MaxLength(AREA_NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({ enum: AREA_ICONS })
  @IsIn(AREA_ICONS)
  icon: string;

  @ApiProperty({ example: '#7c3aed' })
  @Matches(AREA_COLOR_PATTERN, { message: 'color debe ser #rrggbb' })
  color: string;

  /** Si un pedido puede ir a producirse aquí. Default: sí. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isProductionDestination?: boolean;

  /** Si lleva inventario propio. Default: sí. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasInventory?: boolean;

  /** Si todo el equipo ve todos los pedidos del área. Default: sí. */
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

  /**
   * Crea la cuenta compartida del área (responsable por defecto de sus
   * tareas, "cualquiera del área"). Default: sí.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  createSharedAccount?: boolean;

  /** Usuarios existentes que pasan a trabajar en el área. */
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @IsPositive({ each: true })
  userIds?: number[];
}
