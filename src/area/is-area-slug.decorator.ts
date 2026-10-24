import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength } from 'class-validator';
import { AREA_SLUG_MAX_LENGTH, AREA_SLUG_PATTERN } from './area-access';

/**
 * Forma de un slug de área (`taller`, `impresion-3d`). Sólo valida el texto:
 * que el área exista y sirva para ese uso lo comprueba el servicio con
 * `AreaService.assertArea`, porque el catálogo vive en la base.
 */
export function IsAreaSlug(options: { each?: boolean } = {}) {
  const each = options.each ?? false;
  return applyDecorators(
    IsString({ each }),
    MaxLength(AREA_SLUG_MAX_LENGTH, { each }),
    Matches(AREA_SLUG_PATTERN, {
      each,
      message: ({ property }) => `${property} debe ser un área válida`,
    }),
  );
}
