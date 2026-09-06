import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  EmptyToUndefined,
  TrimString,
} from 'src/common/transformers/empty-to-undefined';

export class CreateClientDto {
  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(60)
  first_name: string;

  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(60)
  last_name: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsEmail({}, { message: 'El email no es válido' })
  @MaxLength(120)
  email?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  companyId?: number;
}
