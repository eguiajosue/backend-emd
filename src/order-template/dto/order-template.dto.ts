import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TrimString } from 'src/common/transformers/empty-to-undefined';
import { PRODUCTION_AREAS } from 'src/order/dto/create-order.dto';

/** Mismos límites que el alta de pedido (`CreateOrderDto`). */
export const MAX_TEMPLATE_PRODUCTS = 100;
export const MAX_TEMPLATE_MATERIALS = 50;
export const MAX_TEMPLATE_QUANTITY = 99_999;

export class OrderTemplateProductDto {
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  customName: string;

  @IsInt()
  @Min(1)
  @Max(MAX_TEMPLATE_QUANTITY)
  quantity: number;
}

export class OrderTemplateMaterialDto {
  @IsInt()
  @IsPositive()
  materialId: number;

  @IsInt()
  @Min(1)
  @Max(MAX_TEMPLATE_QUANTITY)
  quantity: number;

  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  description: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  supplierId?: number;
}

export class CreateOrderTemplateDto {
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsBoolean()
  requiresDesign: boolean;

  /** Áreas de producción, la principal primero. Diseño no es un área de producción. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRODUCTION_AREAS.length)
  @IsIn(PRODUCTION_AREAS, { each: true })
  productionAreas?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_TEMPLATE_PRODUCTS)
  @ValidateNested({ each: true })
  @Type(() => OrderTemplateProductDto)
  products: OrderTemplateProductDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TEMPLATE_MATERIALS)
  @ValidateNested({ each: true })
  @Type(() => OrderTemplateMaterialDto)
  materials?: OrderTemplateMaterialDto[];
}

/**
 * Todo opcional. `products`/`materials`, si llegan, REEMPLAZAN las líneas
 * de la plantilla (es lo que manda "Actualizar plantilla" desde el alta).
 */
export class UpdateOrderTemplateDto extends PartialType(
  CreateOrderTemplateDto,
) {}
