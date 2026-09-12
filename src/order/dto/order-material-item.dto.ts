import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { TrimString } from 'src/common/transformers/empty-to-undefined';

/**
 * Línea de la hoja de materiales de un pedido. `description` la arma el
 * frontend a partir del material elegido (nombre + medida + color) pero es
 * editable, así que llega ya resuelta acá — el backend no la recalcula.
 */
export class CreateOrderMaterialItemDto {
  @IsInt()
  @IsPositive()
  materialId: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  description: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  supplierId?: number;
}

export class UpdateOrderMaterialItemDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  supplierId?: number;
}
