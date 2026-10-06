import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  MOCKUP_GARMENT_MESSAGE,
  MOCKUP_GARMENTS,
  MockupGarment,
} from 'src/common/mockup-garments';
import { TrimString } from 'src/common/transformers/empty-to-undefined';

/** Formatos aceptados para la miniatura de la plantilla. */
export const MOCKUP_TEMPLATE_THUMBNAIL_MIME_TYPES = [
  'image/png',
  'image/jpeg',
] as const;

export const MAX_MOCKUP_TEMPLATE_NAME_LENGTH = 80;

/**
 * Tope de la miniatura decodificada. Chico a propósito: el listado devuelve
 * la miniatura de TODAS las plantillas en una sola respuesta (decisión R6:
 * 96KB → ≤ 5MB con 40 plantillas en el peor caso; una JPEG de ~400px pesa
 * ~30KB).
 */
export const MAX_MOCKUP_TEMPLATE_THUMBNAIL_BYTES = 96 * 1024;

/**
 * Tope de la configuración serializada (lleva los diseños embebidos). Igual
 * que un mockup de pedido (`MAX_MOCKUP_BYTES`) y por debajo del
 * `json({ limit: '10mb' })` de src/main.ts junto con la miniatura.
 */
export const MAX_MOCKUP_TEMPLATE_CONFIG_BYTES = 8 * 1024 * 1024;

const NAME_MESSAGE = `El nombre de la plantilla es obligatorio (máx. ${MAX_MOCKUP_TEMPLATE_NAME_LENGTH} caracteres)`;

/**
 * Body de `POST /mockup-templates`. `config` y `thumbnailDataUrl` se
 * validan a fondo en `MockupTemplateService.create` (forma de la
 * configuración, base64 estricto, tipo real por magic bytes, tamaños con
 * 413). `config` no usa `@ValidateNested` a propósito: con
 * `forbidNonWhitelisted` cualquier campo nuevo del estudio rompería el
 * guardado.
 */
export class CreateMockupTemplateDto {
  @ApiProperty({ maxLength: MAX_MOCKUP_TEMPLATE_NAME_LENGTH })
  @TrimString()
  @IsString({ message: NAME_MESSAGE })
  @IsNotEmpty({ message: NAME_MESSAGE })
  @MaxLength(MAX_MOCKUP_TEMPLATE_NAME_LENGTH, { message: NAME_MESSAGE })
  name: string;

  @ApiProperty({ enum: MOCKUP_GARMENTS })
  @IsIn(MOCKUP_GARMENTS, { message: MOCKUP_GARMENT_MESSAGE })
  garment: MockupGarment;

  @ApiProperty({ description: 'MockupConfig del estudio (máx. 8MB).' })
  @IsObject({ message: 'La configuración de la plantilla es obligatoria' })
  config: Record<string, unknown>;

  @ApiProperty({
    description: 'data:image/png|jpeg;base64,... (máx. 96KB decodificada).',
  })
  @IsString({ message: 'La miniatura de la plantilla es obligatoria' })
  @IsNotEmpty({ message: 'La miniatura de la plantilla es obligatoria' })
  thumbnailDataUrl: string;
}

/** Body de `PATCH /mockup-templates/:id`: sólo renombrar. */
export class RenameMockupTemplateDto {
  @ApiProperty({ maxLength: MAX_MOCKUP_TEMPLATE_NAME_LENGTH })
  @TrimString()
  @IsString({ message: NAME_MESSAGE })
  @IsNotEmpty({ message: NAME_MESSAGE })
  @MaxLength(MAX_MOCKUP_TEMPLATE_NAME_LENGTH, { message: NAME_MESSAGE })
  name: string;
}
