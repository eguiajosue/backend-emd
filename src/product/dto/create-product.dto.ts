import { IsNotEmpty, IsOptional, IsInt, IsString } from 'class-validator';

export class CreateProductDto {
  @IsNotEmpty()
  @IsInt()
  productTypeId: number;

  @IsOptional()
  @IsInt()
  colorId?: number;

  @IsOptional()
  @IsInt()
  sizeId?: number;

  @IsOptional()
  @IsString()
  code?: string; // Código opcional

  @IsNotEmpty()
  @IsInt()
  quantity: number; // Cantidad en inventario
}
