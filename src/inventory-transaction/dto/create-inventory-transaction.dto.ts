import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  IsDateString,
} from 'class-validator';

export class CreateInventoryTransactionDto {
  @IsNotEmpty()
  @IsInt()
  productId: number;

  @IsNotEmpty()
  @IsInt()
  quantityChange: number; // Positivo para entrada, negativo para salida

  @IsOptional()
  @IsDateString()
  transactionDate?: Date; // Fecha de la transacción, opcional

  @IsOptional()
  @IsString()
  notes?: string; // Notas adicionales
}
