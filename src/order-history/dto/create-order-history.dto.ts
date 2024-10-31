import {
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsString,
} from 'class-validator';

export class CreateOrderHistoryDto {
  @IsNotEmpty()
  @IsString()
  orderId: string;

  @IsNotEmpty()
  @IsString()
  previousStatusId: string;

  @IsNotEmpty()
  @IsString()
  newStatusId: string;

  @IsOptional()
  @IsDateString()
  changeDate?: Date;
}
