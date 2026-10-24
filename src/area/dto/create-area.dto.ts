import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  Max,
  Min,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  TrimString,
  TrimStringList,
} from 'src/common/transformers/empty-to-undefined';
import { AREA_ICONS } from '../area-icons';
import {
  AREA_FIELD_TYPES,
  CONFIG_NAME_MAX_LENGTH,
  CONFIG_NAME_MIN_LENGTH,
  MAX_AREA_FIELDS,
  MAX_AREA_MACHINES,
  MAX_CAPACITY,
  MAX_FIELD_OPTIONS,
  MAX_TURNAROUND_HOURS,
  type AreaFieldType,
} from '../area-config';
import {
  AREA_STAGE_KINDS,
  MAX_AREA_STAGES,
  STAGE_NAME_MAX_LENGTH,
  STAGE_NAME_MIN_LENGTH,
  type AreaStageKind,
} from '../area-stages';

export const AREA_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const AREA_NAME_MIN_LENGTH = 2;
export const AREA_NAME_MAX_LENGTH = 40;
export const MAX_INVENTORY_SUGGESTIONS = 20;
export const MAX_INVENTORY_SUGGESTION_LENGTH = 40;

/**
 * Una etapa previa a producción. El orden es el de la lista. Sin `id` es una
 * etapa nueva; con `id` (sólo al editar) es una que ya existe.
 */
export class AreaStageInputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsPositive()
  id?: number;

  @ApiProperty({ example: 'Digitalizado' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MinLength(STAGE_NAME_MIN_LENGTH)
  @MaxLength(STAGE_NAME_MAX_LENGTH)
  name: string;

  /** `work`: paso de trabajo. `review`: revisión que se aprueba o se rechaza. */
  @ApiProperty({ enum: AREA_STAGE_KINDS })
  @IsIn(AREA_STAGE_KINDS)
  kind: AreaStageKind;
}

/** Una máquina o equipo del área. Sin `id` es nueva. */
export class AreaMachineInputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsPositive()
  id?: number;

  @ApiProperty({ example: 'Impresora 1' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MinLength(CONFIG_NAME_MIN_LENGTH)
  @MaxLength(CONFIG_NAME_MAX_LENGTH)
  name: string;
}

/** Reemplaza las máquinas de un área (PUT /areas/:id/machines). */
export class SetAreaMachinesDto {
  @ApiProperty({ type: [AreaMachineInputDto] })
  @IsArray()
  @ArrayMaxSize(MAX_AREA_MACHINES)
  @ValidateNested({ each: true })
  @Type(() => AreaMachineInputDto)
  machines: AreaMachineInputDto[];
}

/** Un dato propio que se captura en cada tarea del área. Sin `id` es nuevo. */
export class AreaFieldInputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsPositive()
  id?: number;

  @ApiProperty({ example: 'Material' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MinLength(CONFIG_NAME_MIN_LENGTH)
  @MaxLength(CONFIG_NAME_MAX_LENGTH)
  label: string;

  @ApiProperty({ enum: AREA_FIELD_TYPES })
  @IsIn(AREA_FIELD_TYPES)
  type: AreaFieldType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  /** Sólo `select`: opciones permitidas. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @TrimStringList()
  @IsArray()
  @ArrayMaxSize(MAX_FIELD_OPTIONS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(CONFIG_NAME_MAX_LENGTH, { each: true })
  options?: string[];

  /** Sólo `number`: unidad que se muestra ("cm"). */
  @ApiPropertyOptional()
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(10)
  unit?: string;
}

/** Reemplaza los datos propios de un área (PUT /areas/:id/fields). */
export class SetAreaFieldsDto {
  @ApiProperty({ type: [AreaFieldInputDto] })
  @IsArray()
  @ArrayMaxSize(MAX_AREA_FIELDS)
  @ValidateNested({ each: true })
  @Type(() => AreaFieldInputDto)
  fields: AreaFieldInputDto[];
}

/** Capacidad y tiempos de un área: se aceptan en el alta y en la edición (null los borra). */
export class AreaCapacityFields {
  /** Tareas abiertas que el área puede llevar a la vez. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_CAPACITY)
  capacity?: number | null;

  /** Horas típicas de producción por tarea. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_TURNAROUND_HOURS)
  turnaroundHours?: number | null;
}

/** Reemplaza la lista de etapas de un área (PUT /areas/:id/stages). */
export class SetAreaStagesDto {
  @ApiProperty({ type: [AreaStageInputDto] })
  @IsArray()
  @ArrayMaxSize(MAX_AREA_STAGES)
  @ValidateNested({ each: true })
  @Type(() => AreaStageInputDto)
  stages: AreaStageInputDto[];
}

/** Alta de un área desde el wizard (POST /areas). */
export class CreateAreaDto extends AreaCapacityFields {
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

  /** Etapas previas a producción, en orden. Sin etapas: las tareas nacen listas para producir. */
  @ApiPropertyOptional({ type: [AreaStageInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_AREA_STAGES)
  @ValidateNested({ each: true })
  @Type(() => AreaStageInputDto)
  stages?: AreaStageInputDto[];

  /** Máquinas o equipos del área (opcional). */
  @ApiPropertyOptional({ type: [AreaMachineInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_AREA_MACHINES)
  @ValidateNested({ each: true })
  @Type(() => AreaMachineInputDto)
  machines?: AreaMachineInputDto[];

  /** Datos propios que se capturan en cada tarea del área (opcional). */
  @ApiPropertyOptional({ type: [AreaFieldInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_AREA_FIELDS)
  @ValidateNested({ each: true })
  @Type(() => AreaFieldInputDto)
  fields?: AreaFieldInputDto[];
}
