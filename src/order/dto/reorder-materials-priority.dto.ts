import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsPositive,
} from 'class-validator';

/**
 * Cuerpo de PATCH /orders/materials-priority. `orderIds` va en el orden de
 * prioridad elegido (arrastrado) en la pantalla de "Hoja de Materiales": el
 * primero es el más urgente. Se guarda como índice (0, 1, 2...) en
 * `Order.materialsPriority`. Mismo tope que `BulkOrderActionDto`.
 */
export class ReorderMaterialsPriorityDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'orderIds debe tener al menos un elemento' })
  @ArrayMaxSize(200, {
    message: 'orderIds admite hasta 200 elementos por request',
  })
  @ArrayUnique()
  @IsInt({ each: true })
  @IsPositive({ each: true })
  orderIds: number[];
}
