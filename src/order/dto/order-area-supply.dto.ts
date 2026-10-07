import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SupplySource } from '@prisma/client';
import { PRODUCTION_AREAS } from './create-order.dto';
import { TrimString } from 'src/common/transformers/empty-to-undefined';

/** Máximo de líneas por área en la hoja de materiales. */
export const MAX_SUPPLY_LINES = 50;

/**
 * Una línea de insumo. En origen "nosotros" puede apuntar a un artículo de
 * inventario (`inventoryItemId`) o ser texto libre para lo que no está dado
 * de alta; en origen "cliente" es sólo descripción + cantidad.
 */
export class AreaSupplyLineDto {
  @IsOptional()
  @IsInt()
  inventoryItemId?: number;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity: number;
}

/** Origen de los insumos de UNA tarea de área del pedido. */
export class AreaSupplyDto {
  @IsIn(PRODUCTION_AREAS)
  area: (typeof PRODUCTION_AREAS)[number];

  @IsEnum(SupplySource)
  source: SupplySource;

  @IsArray()
  @ArrayMaxSize(MAX_SUPPLY_LINES)
  @ValidateNested({ each: true })
  @Type(() => AreaSupplyLineDto)
  lines: AreaSupplyLineDto[];
}

/** Body de `PUT /orders/:id/area-supplies`. */
export class SaveAreaSuppliesDto {
  @IsArray()
  @ArrayMaxSize(PRODUCTION_AREAS.length)
  @ValidateNested({ each: true })
  @Type(() => AreaSupplyDto)
  supplies: AreaSupplyDto[];
}
