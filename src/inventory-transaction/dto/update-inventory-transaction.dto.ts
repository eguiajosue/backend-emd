import { PartialType } from '@nestjs/mapped-types';
import { CreateInventoryTransactionDto } from './create-inventory-transaction.dto';

export class UpdateInventoryTransactionDto extends PartialType(CreateInventoryTransactionDto) {}
