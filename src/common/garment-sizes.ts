import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Desglose de tallas de una prenda (camisa, playera, hoodie, polo…). Se usa
 * en las líneas de producto del pedido (`OrderProduct.sizes`) y en la
 * configuración de los mockups (`config.sizes`). Forma:
 *
 *   { general?: { S: 5, M: 2 }, mujer?: { S: 3 }, youth?: { L: 1 } }
 *
 * Corte → talla → piezas. Sólo cortes y tallas conocidos, enteros >= 0.
 * Los ceros se descartan al normalizar; un desglose vacío se guarda null.
 */
export const GARMENT_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] as const;
export const GARMENT_FITS = ['general', 'mujer', 'youth'] as const;

export type GarmentSize = (typeof GARMENT_SIZES)[number];
export type GarmentFit = (typeof GARMENT_FITS)[number];
export type SizeBreakdown = Partial<
  Record<GarmentFit, Partial<Record<GarmentSize, number>>>
>;

/** Máximo de piezas por casilla: evita números absurdos por un dedazo. */
export const MAX_PIECES_PER_SIZE = 100000;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Valida y normaliza un desglose de tallas. `null`/`undefined` → null
 * (sin tallas, compatible con pedidos y mockups viejos). 400 si la forma es
 * inválida.
 */
export function normalizeSizeBreakdown(
  value: unknown,
  subject = 'El desglose de tallas',
): SizeBreakdown | null {
  if (value === null || value === undefined) return null;
  const bad = (msg: string) =>
    new HttpException(`${subject} ${msg}`, HttpStatus.BAD_REQUEST);
  if (!isObj(value)) throw bad('debe ser un objeto');
  const out: SizeBreakdown = {};
  for (const [fit, sizes] of Object.entries(value)) {
    if (!(GARMENT_FITS as readonly string[]).includes(fit)) {
      throw bad(`tiene un corte desconocido: ${fit}`);
    }
    if (!isObj(sizes)) throw bad(`del corte ${fit} debe ser un objeto`);
    const row: Partial<Record<GarmentSize, number>> = {};
    for (const [size, qty] of Object.entries(sizes)) {
      if (!(GARMENT_SIZES as readonly string[]).includes(size)) {
        throw bad(`tiene una talla desconocida: ${size}`);
      }
      if (
        typeof qty !== 'number' ||
        !Number.isInteger(qty) ||
        qty < 0 ||
        qty > MAX_PIECES_PER_SIZE
      ) {
        throw bad(
          `debe tener cantidades enteras no negativas (${fit} ${size})`,
        );
      }
      if (qty > 0) row[size as GarmentSize] = qty;
    }
    if (Object.keys(row).length) out[fit as GarmentFit] = row;
  }
  return Object.keys(out).length ? out : null;
}

/** Total de piezas de un desglose ya normalizado. */
export function sizeBreakdownTotal(b: SizeBreakdown | null): number {
  if (!b) return 0;
  let total = 0;
  for (const row of Object.values(b)) {
    for (const qty of Object.values(row ?? {})) total += qty ?? 0;
  }
  return total;
}
