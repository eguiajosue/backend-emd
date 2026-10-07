import { HttpException, HttpStatus, PipeTransform } from '@nestjs/common';
import { assertBase64FileValid } from 'src/common/file-validation';
import { imageDimensions } from 'src/common/image-dimensions';
import {
  base64DecodedBytes,
  parseImageDataUrl,
} from 'src/common/mockup-validation';

/**
 * Logo de sucursal en dos variantes: `onLight` (para fondos CLAROS, logo
 * negro) y `onDark` (para fondos OSCUROS, logo blanco).
 */
export const BRANCH_LOGO_VARIANTS = ['onLight', 'onDark'] as const;
export type BranchLogoVariant = (typeof BRANCH_LOGO_VARIANTS)[number];

export function isBranchLogoVariant(
  value: unknown,
): value is BranchLogoVariant {
  return (BRANCH_LOGO_VARIANTS as readonly unknown[]).includes(value);
}

/**
 * Sólo PNG, JPEG y WebP. SVG queda FUERA a propósito: puede llevar scripts y
 * el logo se pinta con `<img src="data:...">` en pantallas de toda la planta.
 */
export const BRANCH_LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

/** Tope del logo decodificado. */
export const MAX_BRANCH_LOGO_BYTES = 400 * 1024;
/** Tope de ancho y de alto, en píxeles. */
export const MAX_BRANCH_LOGO_SIDE = 2000;

/**
 * Valida el data URL de un logo de sucursal: base64 estricto y mime permitido
 * (400), ≤ 400 KB decodificado (413), contenido REAL por magic bytes que
 * coincida con lo declarado (400) y ≤ 2000×2000 px según la cabecera (400).
 */
export async function assertBranchLogoValid(
  imageDataUrl: unknown,
): Promise<{ base64: string; mime: string }> {
  const { base64, mime } = parseImageDataUrl(imageDataUrl, {
    allowedMimeTypes: BRANCH_LOGO_MIME_TYPES,
    subject: 'El logo',
    formats: 'PNG, JPEG o WebP',
  });
  const sizeMessage = `El logo no puede superar ${MAX_BRANCH_LOGO_BYTES / 1024} KB`;
  if (base64DecodedBytes(base64) > MAX_BRANCH_LOGO_BYTES) {
    throw new HttpException(sizeMessage, HttpStatus.PAYLOAD_TOO_LARGE);
  }
  const image = await assertBase64FileValid(
    { data: base64, filename: 'logo', mimeType: mime },
    {
      maxBytes: MAX_BRANCH_LOGO_BYTES,
      allowedMimeTypes: BRANCH_LOGO_MIME_TYPES,
      sizeErrorMessage: sizeMessage,
      typeErrorMessage:
        'El contenido del logo no es un PNG, JPEG o WebP válido',
    },
  );
  const size = imageDimensions(image, mime);
  if (!size || size.width < 1 || size.height < 1) {
    throw new HttpException(
      'No se pudieron leer las dimensiones del logo',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (size.width > MAX_BRANCH_LOGO_SIDE || size.height > MAX_BRANCH_LOGO_SIDE) {
    throw new HttpException(
      `El logo no puede superar ${MAX_BRANCH_LOGO_SIDE}×${MAX_BRANCH_LOGO_SIDE} px`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return { base64, mime };
}

/** Pipe de `:variant`: sólo `onLight` u `onDark` (400 con cualquier otra cosa). */
export class ParseBranchLogoVariantPipe
  implements PipeTransform<string, BranchLogoVariant>
{
  transform(value: string): BranchLogoVariant {
    if (!isBranchLogoVariant(value)) {
      throw new HttpException(
        `La variante del logo debe ser ${BRANCH_LOGO_VARIANTS.join(' u ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return value;
  }
}
