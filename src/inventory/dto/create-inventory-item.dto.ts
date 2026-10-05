import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { TrimString } from 'src/common/transformers/empty-to-undefined';
import {
  BARCODE_MAX_LENGTH,
  BARCODE_MIN_LENGTH,
  BARCODE_PATTERN,
  INVENTORY_AREAS,
} from '../inventory.constants';

/**
 * Alta de un artículo en el inventario de un departamento.
 *
 * Los campos de texto opcionales aceptan "" para poder BORRARLOS al editar
 * (el servicio guarda "" como null); los numéricos opcionales aceptan null
 * con el mismo fin.
 *
 * El stock no se edita desde aquí: `initialQuantity` sólo se usa en el alta y
 * queda registrado como una ENTRADA "Stock inicial" del kardex. Después, el
 * stock cambia únicamente con movimientos (ver CreateInventoryMovementDto).
 */
export class CreateInventoryItemDto {
  @IsIn(INVENTORY_AREAS)
  area: (typeof INVENTORY_AREAS)[number];

  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  name: string;

  /** Código interno o del fabricante. Único dentro del departamento. */
  @TrimString()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string;

  /**
   * Código de barras (Code 128) de la etiqueta, único en todo el inventario.
   * Se recorta; sin él (o con null / "") el artículo usa su código por
   * omisión `EMD-` + id con ceros. Sirve para ligar el EAN/UPC del fabricante.
   */
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  })
  @IsOptional()
  @IsString()
  @Length(BARCODE_MIN_LENGTH, BARCODE_MAX_LENGTH, {
    message: `El código de barras debe tener entre ${BARCODE_MIN_LENGTH} y ${BARCODE_MAX_LENGTH} caracteres`,
  })
  @Matches(BARCODE_PATTERN, {
    message:
      'El código de barras sólo admite letras sin acentos, números, espacios y símbolos ASCII',
  })
  barcode?: string | null;

  @TrimString()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  /** Unidad en que se cuenta: "cono", "rollo", "litro", "pieza"... */
  @TrimString()
  @IsNotEmpty({ message: 'La unidad es requerida' })
  @IsString()
  @MaxLength(40)
  unit: string;

  @TrimString()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  color?: string;

  @TrimString()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string;

  /** Ubicación física: "Estante A-3", "Cajón 2". */
  @TrimString()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  @TrimString()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** Punto de reorden. Sin valor = el artículo nunca se marca "bajo stock". */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  minStock?: number | null;

  /** Costo unitario de referencia en MXN. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitCost?: number | null;

  /** Vínculo opcional con el catálogo de Materiales. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  materialId?: number | null;

  /** Proveedor habitual de reposición. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  supplierId?: number | null;

  /** Existencia con la que arranca el artículo (sólo en el alta). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  initialQuantity?: number;
}
