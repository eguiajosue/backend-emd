import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AuthorizationFileDto, PRODUCTION_AREAS } from './create-order.dto';
import { TrimString } from 'src/common/transformers/empty-to-undefined';

/**
 * Body de `POST /orders/:id/design-revisions`: el montaje que Diseño arma
 * para una nueva ronda. Mismo shape/cap de tamaño (5MB) que
 * `AuthorizationFileDto` (ver `assertAuthorizationFileSize`).
 */
export class CreateDesignRevisionDto {
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => AuthorizationFileDto)
  montageFile: AuthorizationFileDto;
}

/**
 * Body de `PATCH /orders/:id/design-revisions/:revisionId/feedback`: lo que
 * Recepción carga después de que el cliente pidió cambios.
 */
export class AddDesignFeedbackDto {
  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  feedbackText: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AuthorizationFileDto)
  feedbackFile?: AuthorizationFileDto;
}

/**
 * Body (opcional) de `PATCH /orders/:id/design-revisions/:revisionId/approve`:
 * permite fijar/corregir el área de producción destino al autorizar.
 */
export class ApproveDesignRevisionDto {
  @IsOptional()
  @IsIn(PRODUCTION_AREAS)
  productionArea?: (typeof PRODUCTION_AREAS)[number];

  // Áreas que van a trabajar el pedido una vez autorizado. Diseño puede definir
  // varias acá si el montaje quedó con más de una técnica (WORKFLOW.md §3).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRODUCTION_AREAS.length)
  @IsIn(PRODUCTION_AREAS, { each: true })
  productionAreas?: (typeof PRODUCTION_AREAS)[number][];
}
