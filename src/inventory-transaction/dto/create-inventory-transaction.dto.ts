import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  EmptyToUndefined,
  TrimString,
} from 'src/common/transformers/empty-to-undefined';

export class CreateInventoryTransactionDto {
  @IsNotEmpty()
  @IsInt()
  @IsPositive()
  productId: number;

  /** Positivo para entrada, negativo para salida. */
  @IsNotEmpty()
  @IsInt()
  quantityChange: number;

  @EmptyToUndefined()
  @IsOptional()
  @IsDateString()
  transactionDate?: string;

  @EmptyToUndefined()
  @TrimString()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
