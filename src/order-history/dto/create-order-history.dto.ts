import {
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsNumber,
} from 'class-validator';

export class CreateOrderHistoryDto {
  @IsNotEmpty()
  @IsNumber()
  orderId: number;

  @IsNotEmpty()
  @IsNumber()
  previousStatusId: number;

  @IsNotEmpty()
  @IsNumber()
  newStatusId: number;

  @IsOptional()
  @IsDateString()
  changeDate?: Date;
}
