/** Semáforo de existencias de un artículo. */
export type InventoryStockStatus = 'ok' | 'low' | 'out';

/**
 * Código de barras de las etiquetas (simbología Code 128): de 3 a 64
 * caracteres ASCII imprimibles (0x20–0x7E), sin espacios al inicio ni al
 * final (se recortan antes de validar). Así cabe tanto el código propio
 * (`EMD-000123`) como el EAN/UPC que trae el fabricante.
 */
export const BARCODE_MIN_LENGTH = 3;
export const BARCODE_MAX_LENGTH = 64;
export const BARCODE_PATTERN = /^[\x20-\x7E]+$/;

/** Los códigos `EMD-<número>` los asigna el sistema (uno por artículo). */
export const RESERVED_BARCODE_PATTERN = /^EMD-\d+$/;

/** Código por omisión de un artículo: `EMD-` + id con ceros (EMD-000123). */
export function defaultBarcode(id: number): string {
  return `EMD-${String(id).padStart(6, '0')}`;
}
