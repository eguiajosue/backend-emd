import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TrimString } from 'src/common/transformers/empty-to-undefined';

export class CreateBranchDto {
  @TrimString()
  @IsNotEmpty({ message: 'El nombre de la sucursal es obligatorio' })
  @IsString()
  @MaxLength(80)
  name: string;
}

export class UpdateBranchDto {
  @TrimString()
  @IsOptional()
  @IsNotEmpty({ message: 'El nombre de la sucursal es obligatorio' })
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateBranchEmployeeDto {
  @TrimString()
  @IsNotEmpty({ message: 'El nombre del empleado es obligatorio' })
  @IsString()
  @MaxLength(80)
  name: string;
}

export class UpdateBranchEmployeeDto {
  @TrimString()
  @IsOptional()
  @IsNotEmpty({ message: 'El nombre del empleado es obligatorio' })
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
