import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TrimString } from 'src/common/transformers/empty-to-undefined';

export class LoginDto {
  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(40)
  username: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(72)
  password: string;
}
