import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import {
  EmptyToUndefined,
  TrimString,
} from 'src/common/transformers/empty-to-undefined';

export const SUPPLIER_LOCATIONS = [
  'nacional',
  'local',
  'internacional',
] as const;

/** Alta de un proveedor de materiales/insumos. */
export class CreateSupplierDto {
  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsEmail({}, { message: 'El email no es válido' })
  @MaxLength(120)
  email?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsUrl({ require_protocol: false }, { message: 'La web no es válida' })
  @MaxLength(200)
  website?: string;

  /** Alcance del proveedor: nacional | local | internacional. */
  @IsIn(SUPPLIER_LOCATIONS)
  location: (typeof SUPPLIER_LOCATIONS)[number];
}
