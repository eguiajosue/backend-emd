import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  EmptyToUndefined,
  TrimString,
} from 'src/common/transformers/empty-to-undefined';

export class CreateCompanyDto {
  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;

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

  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;
}
