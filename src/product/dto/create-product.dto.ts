import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EmptyToUndefined,
  TrimString,
} from 'src/common/transformers/empty-to-undefined';

export class CreateProductDto {
  @IsNotEmpty()
  @IsInt()
  @IsPositive()
  productTypeId: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  colorId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  sizeId?: number;

  @EmptyToUndefined()
  @TrimString()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string;

  @IsNotEmpty()
  @IsInt()
  @Min(0)
  quantity: number;
}
