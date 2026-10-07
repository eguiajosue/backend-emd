import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateOrderDto } from './create-order.dto';

// `branchEmployeeId` se fija sólo al crear (cuenta de sucursal): no se edita.
export class UpdateOrderDto extends PartialType(
  OmitType(CreateOrderDto, ['branchEmployeeId'] as const),
) {}
