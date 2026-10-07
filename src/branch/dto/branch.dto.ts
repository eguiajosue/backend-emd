import { ApiProperty } from '@nestjs/swagger';
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

/**
 * Body de `PUT /branches/:id/logo/:variant`. El data URL se valida a fondo en
 * `BranchService.setLogo` (base64 estricto, firma real PNG/JPEG/WebP, 400 KB,
 * 2000×2000 px).
 */
export class SetBranchLogoDto {
  @ApiProperty({
    description:
      'data:image/(png|jpeg|webp);base64,... (máx. 400 KB y 2000×2000 px).',
  })
  @IsString({ message: 'La imagen del logo es obligatoria' })
  @IsNotEmpty({ message: 'La imagen del logo es obligatoria' })
  imageDataUrl: string;
}
