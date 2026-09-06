import {
  ArrayNotEmpty,
  ArrayUnique,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  EmptyToUndefined,
  TrimString,
} from 'src/common/transformers/empty-to-undefined';

export const PASSWORD_POLICY_MESSAGE =
  'La contraseña debe tener al menos 8 caracteres, una mayúscula y un número';

export class CreateUserDto {
  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(60)
  firstName: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  lastName?: string;

  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  username: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8, { message: PASSWORD_POLICY_MESSAGE })
  @MaxLength(72)
  @Matches(/(?=.*[A-Z])(?=.*\d)/, { message: PASSWORD_POLICY_MESSAGE })
  password: string;

  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  roleIds: number[];
}
