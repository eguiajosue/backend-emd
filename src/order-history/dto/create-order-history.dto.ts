import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
} from 'class-validator';
import { EmptyToUndefined } from 'src/common/transformers/empty-to-undefined';

export class CreateOrderHistoryDto {
  @IsNotEmpty()
  @IsInt()
  @IsPositive()
  orderId: number;

  @IsNotEmpty()
  @IsInt()
  @IsPositive()
  previousStatusId: number;

  @IsNotEmpty()
  @IsInt()
  @IsPositive()
  newStatusId: number;

  @EmptyToUndefined()
  @IsOptional()
  @IsDateString()
  changeDate?: string;
}
