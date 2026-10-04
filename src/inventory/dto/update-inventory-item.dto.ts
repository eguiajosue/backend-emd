import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateInventoryItemDto } from './create-inventory-item.dto';

/** Edición de los datos del artículo. El stock se mueve con movimientos, no aquí. */
export class UpdateInventoryItemDto extends PartialType(
  OmitType(CreateInventoryItemDto, ['initialQuantity'] as const),
) {}
