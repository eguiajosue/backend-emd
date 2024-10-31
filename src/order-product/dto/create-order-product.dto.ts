import { IsString, IsNotEmpty, IsInt, Min } from 'class-validator';

export class CreateOrderProductDto {
  @IsNotEmpty()
  @IsString()
  orderId: string;

  @IsNotEmpty()
  @IsInt()
  productId: number;

  @IsNotEmpty()
  @IsInt()
  @Min(1, { message: 'La cantidad debe ser al menos 1' })
  quantity: number; // Cantidad de producto que se pide
}
