import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OrderFileDto, PRODUCTION_AREAS } from './create-order.dto';
import { TrimString } from 'src/common/transformers/empty-to-undefined';

/** Máximo de archivos que admite una ronda, por lado (montaje / feedback). */
export const MAX_DESIGN_REVISION_FILES = 10;

/**
 * Body de `POST /orders/:id/design-revisions`: el montaje que Diseño arma
 * para una nueva ronda — la HOJA DE AUTORIZACIÓN real que Recepción le manda
 * al cliente. Mismo shape/cap de tamaño (5MB por archivo) que cualquier otro
 * `OrderFileDto` (ver `assertOrderFileValid`).
 *
 * Una ronda admite VARIOS archivos (varias imágenes o un PDF, WORKFLOW.md §2):
 * el contrato nuevo es `montageFiles`. `montageFile` (singular) se mantiene
 * por compatibilidad con los clientes viejos; hay que mandar al menos uno de
 * los dos (lo valida `OrderService.resolveRevisionFiles`).
 */
export class CreateDesignRevisionDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderFileDto)
  montageFile?: OrderFileDto;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DESIGN_REVISION_FILES)
  @ValidateNested({ each: true })
  @Type(() => OrderFileDto)
  montageFiles?: OrderFileDto[];
}

/**
 * Body de `PATCH /orders/:id/design-revisions/:revisionId/feedback`: lo que
 * Recepción carga después de que el cliente pidió cambios. El adjunto es
 * opcional, pero si viene puede ser uno (`feedbackFile`) o varios
 * (`feedbackFiles`).
 */
export class AddDesignFeedbackDto {
  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  feedbackText: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderFileDto)
  feedbackFile?: OrderFileDto;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DESIGN_REVISION_FILES)
  @ValidateNested({ each: true })
  @Type(() => OrderFileDto)
  feedbackFiles?: OrderFileDto[];
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
