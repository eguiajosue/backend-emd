import { ORDER_AREAS } from 'src/order/dto/create-order.dto';

/**
 * Departamentos que llevan inventario propio: las áreas operativas de un
 * pedido (ORDER_AREAS) más Recepción, que también tiene existencias propias
 * (papelería, empaques, consumibles de oficina). Cada valor coincide con el
 * nombre del rol del área, así se puede derivar qué inventario ve cada quien.
 */
export const INVENTORY_AREAS = [...ORDER_AREAS, 'recepcion'] as const;

export type InventoryArea = (typeof INVENTORY_AREAS)[number];

/** Semáforo de existencias de un artículo. */
export type InventoryStockStatus = 'ok' | 'low' | 'out';
