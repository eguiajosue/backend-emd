import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TrimString } from 'src/common/transformers/empty-to-undefined';

/** Formatos aceptados para un logo de la biblioteca (transparencia: PNG). */
export const MOCKUP_LOGO_MIME_TYPES = ['image/png'] as const;

export const MAX_MOCKUP_LOGO_NAME_LENGTH = 80;

/** Tope del logo decodificado (el frontend lo reduce a ≤ 1024px antes). */
export const MAX_MOCKUP_LOGO_BYTES = 2 * 1024 * 1024;

const NAME_MESSAGE = `El nombre del logo es obligatorio (máx. ${MAX_MOCKUP_LOGO_NAME_LENGTH} caracteres)`;

/**
 * Body de `POST /mockup-logos`. `imageDataUrl` se valida a fondo en
 * `MockupLogoService.create` (base64 estricto, PNG por magic bytes, tamaño
 * con 413).
 */
export class CreateMockupLogoDto {
  @ApiProperty({ maxLength: MAX_MOCKUP_LOGO_NAME_LENGTH })
  @TrimString()
  @IsString({ message: NAME_MESSAGE })
  @IsNotEmpty({ message: NAME_MESSAGE })
  @MaxLength(MAX_MOCKUP_LOGO_NAME_LENGTH, { message: NAME_MESSAGE })
  name: string;

  @ApiProperty({ description: 'data:image/png;base64,... (máx. 2MB).' })
  @IsString({ message: 'La imagen del logo es obligatoria' })
  @IsNotEmpty({ message: 'La imagen del logo es obligatoria' })
  imageDataUrl: string;
}

/** Body de `PATCH /mockup-logos/:id`: sólo renombrar. */
export class RenameMockupLogoDto {
  @ApiProperty({ maxLength: MAX_MOCKUP_LOGO_NAME_LENGTH })
  @TrimString()
  @IsString({ message: NAME_MESSAGE })
  @IsNotEmpty({ message: NAME_MESSAGE })
  @MaxLength(MAX_MOCKUP_LOGO_NAME_LENGTH, { message: NAME_MESSAGE })
  name: string;
}
