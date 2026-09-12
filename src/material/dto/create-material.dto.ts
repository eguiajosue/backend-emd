import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  EmptyToUndefined,
  TrimString,
} from 'src/common/transformers/empty-to-undefined';
import { ORDER_AREAS } from 'src/order/dto/create-order.dto';

/**
 * Alta de un material/insumo del catálogo (PVC, acrílico, MDF, perfiles
 * metálicos, tornillería, consumibles de DTF/Bordado, etc.). `category` y
 * `unit` llegan como NOMBRE (no id): el servicio los resuelve/crea si no
 * existen todavía (mismo patrón que los productos frecuentes de un pedido).
 */
export class CreateMaterialDto {
  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(40)
  unit?: string;

  /** Grosor/calibre/tamaño en texto libre (ej. "6mm", "3/16 x 1 1/4"). */
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(100)
  measure?: string;

  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(60)
  color?: string;

  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(80)
  brand?: string;

  /** Proveedor preferido, opcional — la hoja de un pedido puede usar otro. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  supplierId?: number;

  /** Áreas de producción donde se suele usar este material. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ORDER_AREAS.length)
  @IsIn(ORDER_AREAS, { each: true })
  areas?: (typeof ORDER_AREAS)[number][];
}
