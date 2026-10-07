/**
 * Prendas del creador de mockups 3D (frontend `lib/mockups/garments.ts`).
 * Una sola lista para los mockups de pedido (`order-mockup`) y las
 * plantillas (`mockup-template`): habilitar una prenda en el frontend no
 * debe dejar "Adjuntar al pedido" o "Guardar como plantilla" en 400 porque
 * una de las dos listas quedó atrás (decisión R11 de
 * frontend-emd/docs/plans/sidebar-y-mockups-v2.md). Que la UI muestre o no
 * una prenda lo decide el frontend (`ENABLED_GARMENTS`).
 *
 * Rotulaciones: `car` (carro), `minivan`, `pickup`, `trailer` (tráiler) y
 * `bicycle` (bicicleta). El tráiler guarda qué parte se rotula en
 * `config.vehiclePart` (`MOCKUP_VEHICLE_PARTS`).
 */
export const MOCKUP_GARMENTS = [
  'tshirt',
  'cap',
  'hoodie',
  'dress-shirt',
  'termo',
  'taza',
  // Rotulaciones (vinil sobre vehículos): el estudio las agrupa en la
  // categoría "Rotulaciones". Sin tallas ni panel láser.
  'car',
  'minivan',
  'pickup',
  'trailer',
  'bicycle',
] as const;
export type MockupGarment = (typeof MOCKUP_GARMENTS)[number];

/** Vehículos del estudio de Rotulaciones. */
export const MOCKUP_VEHICLE_GARMENTS = [
  'car',
  'minivan',
  'pickup',
  'trailer',
  'bicycle',
] as const satisfies readonly MockupGarment[];

export function isMockupVehicle(value: unknown): boolean {
  return MOCKUP_VEHICLE_GARMENTS.includes(
    value as (typeof MOCKUP_VEHICLE_GARMENTS)[number],
  );
}

/**
 * Parte del tráiler que se rotula (`config.vehiclePart`): `full` = tráiler
 * completo, `cab` = sólo la cabina (tractocamión) y `box` = sólo la caja.
 */
export const MOCKUP_VEHICLE_PARTS = ['full', 'cab', 'box'] as const;
export type MockupVehiclePart = (typeof MOCKUP_VEHICLE_PARTS)[number];

export function isMockupVehiclePart(
  value: unknown,
): value is MockupVehiclePart {
  return MOCKUP_VEHICLE_PARTS.includes(value as MockupVehiclePart);
}

/** Mensaje de 400 para un `config.vehiclePart` inválido. */
export const MOCKUP_VEHICLE_PART_MESSAGE =
  'La parte del tráiler debe ser completo (full), cabina (cab) o caja (box)';

export function isMockupGarment(value: unknown): value is MockupGarment {
  return MOCKUP_GARMENTS.includes(value as MockupGarment);
}

/** Mensaje de 400 para una prenda fuera de `MOCKUP_GARMENTS`. */
export const MOCKUP_GARMENT_MESSAGE =
  'La prenda debe ser playera (tshirt), gorra (cap), sudadera (hoodie), camisa (dress-shirt), termo (termo), taza (taza), carro (car), minivan (minivan), pickup (pickup), tráiler (trailer) o bicicleta (bicycle)';
