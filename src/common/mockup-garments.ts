/**
 * Prendas del creador de mockups 3D (frontend `lib/mockups/garments.ts`).
 * Una sola lista para los mockups de pedido (`order-mockup`) y las
 * plantillas (`mockup-template`): habilitar una prenda en el frontend no
 * debe dejar "Adjuntar al pedido" o "Guardar como plantilla" en 400 porque
 * una de las dos listas quedó atrás (decisión R11 de
 * frontend-emd/docs/plans/sidebar-y-mockups-v2.md). Que la UI muestre o no
 * una prenda lo decide el frontend (`ENABLED_GARMENTS`).
 */
export const MOCKUP_GARMENTS = [
  'tshirt',
  'cap',
  'hoodie',
  'dress-shirt',
  'termo',
  'taza',
] as const;
export type MockupGarment = (typeof MOCKUP_GARMENTS)[number];

export function isMockupGarment(value: unknown): value is MockupGarment {
  return MOCKUP_GARMENTS.includes(value as MockupGarment);
}

/** Mensaje de 400 para una prenda fuera de `MOCKUP_GARMENTS`. */
export const MOCKUP_GARMENT_MESSAGE =
  'La prenda debe ser playera (tshirt), gorra (cap), sudadera (hoodie), camisa (dress-shirt), termo (termo) o taza (taza)';
