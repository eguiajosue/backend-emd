import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateLogDto {
  @IsNumber()
  @IsNotEmpty()
  userId: number;
  @IsString()
  @IsNotEmpty()
  action: string;
}
