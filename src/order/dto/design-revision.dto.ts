import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MAX_ORDER_AREAS, OrderFileDto } from './create-order.dto';
import { IsAreaSlug } from 'src/area/is-area-slug.decorator';
import { TrimString } from 'src/common/transformers/empty-to-undefined';
import { AreaSupplyDto } from './order-area-supply.dto';

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
 * permite fijar/corregir el área de producción destino al autorizar y trae
 * la hoja de materiales (origen de insumos por área).
 */
export class ApproveDesignRevisionDto {
  @IsOptional()
  @IsAreaSlug()
  productionArea?: string;

  // Áreas que van a trabajar el pedido una vez autorizado. Diseño puede definir
  // varias aquí si el montaje quedó con más de una técnica (WORKFLOW.md §3).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ORDER_AREAS)
  @IsAreaSlug({ each: true })
  productionAreas?: string[];

  // Hoja de materiales: origen de los insumos de cada área (cliente o
  // nosotros). Es obligatoria: el pedido pasa a producción al guardarla, en
  // la misma transacción que la autorización (WORKFLOW.md §3).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ORDER_AREAS)
  @ValidateNested({ each: true })
  @Type(() => AreaSupplyDto)
  supplies?: AreaSupplyDto[];
}
