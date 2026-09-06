import { IsInt, IsNotEmpty, IsPositive, Min } from 'class-validator';

export class CreateOrderProductDto {
  @IsNotEmpty()
  @IsInt()
  @IsPositive()
  orderId: number;

  @IsNotEmpty()
  @IsInt()
  @IsPositive()
  productId: number;

  @IsNotEmpty()
  @IsInt()
  @Min(1, { message: 'La cantidad debe ser al menos 1' })
  quantity: number;
}
