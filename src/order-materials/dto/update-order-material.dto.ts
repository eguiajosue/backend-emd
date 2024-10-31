import { PartialType } from '@nestjs/mapped-types';
import { CreateOrderMaterialDto } from './create-order-material.dto';

export class UpdateOrderMaterialDto extends PartialType(CreateOrderMaterialDto) {}
