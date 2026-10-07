import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import {
  MOCKUP_GARMENT_MESSAGE,
  MOCKUP_GARMENTS,
  MockupGarment,
} from 'src/common/mockup-garments';

/** Formatos aceptados para la lámina exportada del mockup. */
export const MOCKUP_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg'] as const;

/**
 * Tope de un mockup (decisión R1 de docs/plans/mockups-3d.md en el
 * frontend; coincide con `MAX_MOCKUP_BYTES` de `lib/mockups/types.ts`): la
 * lámina decodificada, la configuración (que lleva los diseños embebidos
 * para poder re-editarlo) y la suma de ambas no pueden pasar de 8MB. Queda
 * por debajo del `json({ limit: '10mb' })` de src/main.ts, así que el
 * usuario recibe este 413 con mensaje claro en vez del 413 genérico del
 * body-parser.
 */
export const MAX_MOCKUP_BYTES = 8 * 1024 * 1024;

/**
 * Body de `POST /orders/:id/mockups` (frontend `CreateOrderMockupPayload`).
 *
 * `imageDataUrl` y `config` se validan a fondo en
 * `OrderMockupService.create` (tipo real por magic bytes, tamaño con 413,
 * forma de la configuración): acá sólo el shape básico. `config` no usa
 * `@ValidateNested` a propósito: con `forbidNonWhitelisted` cualquier campo
 * nuevo que agregue el estudio rompería el guardado.
 */
export class CreateOrderMockupDto {
  @IsIn(MOCKUP_GARMENTS, { message: MOCKUP_GARMENT_MESSAGE })
  garment: MockupGarment;

  @IsString({ message: 'La imagen del mockup es obligatoria' })
  @IsNotEmpty({ message: 'La imagen del mockup es obligatoria' })
  imageDataUrl: string;

  @IsObject({ message: 'La configuración del mockup es obligatoria' })
  config: Record<string, unknown>;

  /**
   * Empleado de la sucursal que armó el mockup (opcional, sólo desde la
   * cuenta de sucursal; se valida que sea de esa sucursal y esté activo).
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  branchEmployeeId?: number;
}
