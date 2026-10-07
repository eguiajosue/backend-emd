import { InventoryMovementType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EmptyToUndefined,
  TrimString,
} from 'src/common/transformers/empty-to-undefined';

/**
 * Movimiento de inventario (kardex):
 *
 * - `ENTRADA`: `quantity` (> 0) se SUMA al stock. Si viene `unitCost`, pasa a
 *   ser el costo de referencia del artículo.
 * - `SALIDA`: `quantity` (> 0) se RESTA. No puede dejar el stock negativo.
 * - `AJUSTE`: `quantity` (>= 0) es lo que se CONTÓ físicamente; el stock pasa
 *   a ese valor y se registra la diferencia.
 *
 * Las áreas de producción sólo registran `ENTRADA` (alguien les trajo el
 * insumo directo) y `SALIDA` (consumo); el `AJUSTE` es de Recepción/admin.
 */
export class CreateInventoryMovementDto {
  @IsEnum(InventoryMovementType)
  type: InventoryMovementType;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  // Evita desbordar el Decimal(12,3) de la columna (500).
  @Max(999999)
  quantity: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999)
  unitCost?: number;

  @TrimString()
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Motivo para la bitácora ("Lo trajo el proveedor", "Consumo del día"...). */
  @TrimString()
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(300)
  reason?: string;

  /** Pedido al que se imputa el consumo (opcional). */
  @IsOptional()
  @IsInt()
  @IsPositive()
  orderId?: number;
}
