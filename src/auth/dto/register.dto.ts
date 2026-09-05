import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsNotEmpty()
  @IsString()
  firstName: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @Transform(({ value }) => value.trim())
  @IsNotEmpty()
  @IsString()
  username: string;

  @Transform(({ value }) => value.trim())
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password: string;

  @ArrayNotEmpty()
  @IsInt({ each: true })
  roleIds: number[];
}
