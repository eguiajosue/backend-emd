import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TrimString } from 'src/common/transformers/empty-to-undefined';

export class CreateOrderProductPresetDto {
  @ApiProperty({ minLength: 1, maxLength: 80 })
  @TrimString()
  @IsString()
  @IsNotEmpty({ message: 'El nombre del producto es obligatorio' })
  @MaxLength(80)
  name: string;
}
