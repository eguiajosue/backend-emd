import {
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { TrimString } from 'src/common/transformers/empty-to-undefined';

export class CreateLogDto {
  @IsNotEmpty()
  @IsInt()
  @IsPositive()
  userId: number;

  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  action: string;
}
