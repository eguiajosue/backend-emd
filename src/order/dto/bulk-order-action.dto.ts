import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsPositive,
  ValidateIf,
} from 'class-validator';
import { ORDER_AREAS } from './create-order.dto';

/**
 * Cuerpo de POST /orders/bulk-actions. Requiere `orderIds` + al menos uno de
 * `statusId`/`area` (mismos campos que ya acepta PATCH /orders/:id, para
 * mantener el mismo criterio de validación/permisos que el endpoint
 * individual). Tope de 100 ids por request: evita transacciones gigantes que
 * mantengan locks de DB por demasiado tiempo.
 */
export class BulkOrderActionDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'orderIds debe tener al menos un elemento' })
  @ArrayMaxSize(100, {
    message: 'orderIds admite hasta 100 elementos por request',
  })
  @ArrayUnique()
  @IsInt({ each: true })
  @IsPositive({ each: true })
  orderIds: number[];

  @ValidateIf((dto: BulkOrderActionDto) => dto.statusId !== undefined)
  @IsInt()
  @IsPositive()
  statusId?: number;

  @ValidateIf((dto: BulkOrderActionDto) => dto.area !== undefined)
  @IsIn(ORDER_AREAS)
  area?: (typeof ORDER_AREAS)[number];
}
