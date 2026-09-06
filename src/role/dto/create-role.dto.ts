import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TrimString } from 'src/common/transformers/empty-to-undefined';

export class CreateRoleDto {
  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(60)
  name: string;
}
