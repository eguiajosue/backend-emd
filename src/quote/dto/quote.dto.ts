import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateBy,
  ValidateIf,
  ValidateNested,
  ValidationOptions,
} from 'class-validator';
import { TrimString } from 'src/common/transformers/empty-to-undefined';
import {
  MAX_QUOTE_BULK_ITEMS,
  MAX_QUOTE_CLIENT_NAME_LENGTH,
  MAX_QUOTE_COMMENT_LENGTH,
  MAX_QUOTE_DESCRIPTION_LENGTH,
  MAX_QUOTE_SEARCH_LENGTH,
  QUOTE_CLIENT_NAME_MESSAGE,
  QUOTE_COMMENT_MESSAGE,
  QUOTE_DESCRIPTION_MESSAGE,
  QUOTE_NUL_MESSAGE,
  QUOTE_PRIORITY_DATE_MESSAGE,
  QUOTE_STAGES,
  QUOTE_STAGE_MESSAGE,
  QUOTE_STATUSES,
  QUOTE_STATUS_MESSAGE,
  QuoteStage,
  QuoteStatus,
  isIsoDateOnly,
} from '../quote.constants';

/**
 * Rechaza strings con NUL (`\u0000`): Postgres no los acepta en TEXT y el
 * INSERT fallaría con 500. Valores que no son string pasan (los valida
 * `@IsString`).
 */
export function NoNulChars(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'noNulChars',
      validator: {
        validate: (value: unknown) =>
          typeof value !== 'string' || !value.includes('\u0000'),
        defaultMessage: () => QUOTE_NUL_MESSAGE,
      },
    },
    options,
  );
}

/** `YYYY-MM-DD` que sea una fecha real. */
export function IsDateOnly(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isDateOnly',
      validator: {
        validate: (value: unknown) => isIsoDateOnly(value),
        defaultMessage: () => QUOTE_PRIORITY_DATE_MESSAGE,
      },
    },
    options,
  );
}

const CLIENT_ID_MESSAGE = 'El cliente debe ser un id numérico válido';

/**
 * Body de `POST /quotes` (y de cada ítem de `POST /quotes/bulk`).
 *
 * `clientName` es obligatorio salvo que venga `clientId`: en ese caso, si
 * llega vacío, el service lo completa con el nombre del cliente registrado.
 * `stage`/`status` son opcionales: sin ninguno queda `por_enviar`/`lista`;
 * con sólo la etapa, el subestado por defecto de esa etapa; con sólo el
 * subestado, su etapa. La coherencia etapa/subestado la valida el service.
 */
export class CreateQuoteDto {
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt({ message: CLIENT_ID_MESSAGE })
  @IsPositive({ message: CLIENT_ID_MESSAGE })
  clientId?: number | null;

  @ApiPropertyOptional({ maxLength: MAX_QUOTE_CLIENT_NAME_LENGTH })
  @ValidateIf((o) => o.clientId == null || o.clientName != null)
  @TrimString()
  @IsString({ message: QUOTE_CLIENT_NAME_MESSAGE })
  @MaxLength(MAX_QUOTE_CLIENT_NAME_LENGTH, {
    message: QUOTE_CLIENT_NAME_MESSAGE,
  })
  @NoNulChars()
  clientName?: string;

  @ApiProperty({ maxLength: MAX_QUOTE_DESCRIPTION_LENGTH })
  @TrimString()
  @IsString({ message: QUOTE_DESCRIPTION_MESSAGE })
  @IsNotEmpty({ message: QUOTE_DESCRIPTION_MESSAGE })
  @MaxLength(MAX_QUOTE_DESCRIPTION_LENGTH, {
    message: QUOTE_DESCRIPTION_MESSAGE,
  })
  @NoNulChars()
  description: string;

  @ApiPropertyOptional({ enum: QUOTE_STAGES })
  @IsOptional()
  @IsIn(QUOTE_STAGES, { message: QUOTE_STAGE_MESSAGE })
  stage?: QuoteStage;

  @ApiPropertyOptional({ enum: QUOTE_STATUSES })
  @IsOptional()
  @IsIn(QUOTE_STATUSES, { message: QUOTE_STATUS_MESSAGE })
  status?: QuoteStatus;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'YYYY-MM-DD; null = prioridad normal.',
  })
  @IsOptional()
  @IsDateOnly()
  priorityDate?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: MAX_QUOTE_COMMENT_LENGTH,
  })
  @IsOptional()
  @TrimString()
  @IsString({ message: QUOTE_COMMENT_MESSAGE })
  @MaxLength(MAX_QUOTE_COMMENT_LENGTH, { message: QUOTE_COMMENT_MESSAGE })
  @NoNulChars()
  comment?: string | null;
}

/** Body de `POST /quotes/bulk` ("pegar lista"): 1 a 100 cotizaciones. */
export class BulkCreateQuotesDto {
  @ApiProperty({ type: [CreateQuoteDto], minItems: 1, maxItems: 100 })
  @IsArray({ message: 'items debe ser una lista de cotizaciones' })
  @ArrayMinSize(1, { message: 'Agrega al menos una cotización' })
  @ArrayMaxSize(MAX_QUOTE_BULK_ITEMS, {
    message: `No se pueden cargar más de ${MAX_QUOTE_BULK_ITEMS} cotizaciones a la vez`,
  })
  @ValidateNested({ each: true })
  @Type(() => CreateQuoteDto)
  items: CreateQuoteDto[];
}

/**
 * Body de `PATCH /quotes/:id`: cualquier campo editable. `clientId: null`
 * desliga el cliente registrado (queda el nombre escrito);
 * `priorityDate: null` vuelve a prioridad normal; `comment: null` (o vacío)
 * borra el comentario. `clientName`, `description`, `stage` y `status` no
 * aceptan null. Cambiar la etapa sin subestado pone el subestado por
 * defecto de la nueva etapa.
 */
export class UpdateQuoteDto {
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt({ message: CLIENT_ID_MESSAGE })
  @IsPositive({ message: CLIENT_ID_MESSAGE })
  clientId?: number | null;

  @ApiPropertyOptional({ maxLength: MAX_QUOTE_CLIENT_NAME_LENGTH })
  @ValidateIf((o) => o.clientName !== undefined)
  @TrimString()
  @IsString({ message: QUOTE_CLIENT_NAME_MESSAGE })
  @MaxLength(MAX_QUOTE_CLIENT_NAME_LENGTH, {
    message: QUOTE_CLIENT_NAME_MESSAGE,
  })
  @NoNulChars()
  clientName?: string;

  @ApiPropertyOptional({ maxLength: MAX_QUOTE_DESCRIPTION_LENGTH })
  @ValidateIf((o) => o.description !== undefined)
  @TrimString()
  @IsString({ message: QUOTE_DESCRIPTION_MESSAGE })
  @IsNotEmpty({ message: QUOTE_DESCRIPTION_MESSAGE })
  @MaxLength(MAX_QUOTE_DESCRIPTION_LENGTH, {
    message: QUOTE_DESCRIPTION_MESSAGE,
  })
  @NoNulChars()
  description?: string;

  @ApiPropertyOptional({ enum: QUOTE_STAGES })
  @ValidateIf((o) => o.stage !== undefined)
  @IsIn(QUOTE_STAGES, { message: QUOTE_STAGE_MESSAGE })
  stage?: QuoteStage;

  @ApiPropertyOptional({ enum: QUOTE_STATUSES })
  @ValidateIf((o) => o.status !== undefined)
  @IsIn(QUOTE_STATUSES, { message: QUOTE_STATUS_MESSAGE })
  status?: QuoteStatus;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsDateOnly()
  priorityDate?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: MAX_QUOTE_COMMENT_LENGTH,
  })
  @IsOptional()
  @TrimString()
  @IsString({ message: QUOTE_COMMENT_MESSAGE })
  @MaxLength(MAX_QUOTE_COMMENT_LENGTH, { message: QUOTE_COMMENT_MESSAGE })
  @NoNulChars()
  comment?: string | null;
}

/** Body de `POST /quotes/:id/link-order`. */
export class LinkQuoteOrderDto {
  @ApiProperty()
  @IsInt({ message: 'El pedido debe ser un id numérico válido' })
  @IsPositive({ message: 'El pedido debe ser un id numérico válido' })
  orderId: number;
}

/** Query de `GET /quotes`. */
export class ListQuotesQueryDto {
  @ApiPropertyOptional({ enum: QUOTE_STAGES })
  @IsOptional()
  @IsIn(QUOTE_STAGES, { message: QUOTE_STAGE_MESSAGE })
  stage?: QuoteStage;

  @ApiPropertyOptional({ enum: QUOTE_STATUSES })
  @IsOptional()
  @IsIn(QUOTE_STATUSES, { message: QUOTE_STATUS_MESSAGE })
  status?: QuoteStatus;

  @ApiPropertyOptional({
    maxLength: MAX_QUOTE_SEARCH_LENGTH,
    description:
      'Busca en cliente y descripción (sin distinguir mayúsculas ni acentos).',
  })
  @IsOptional()
  @TrimString()
  @IsString({ message: 'La búsqueda debe ser texto' })
  @MaxLength(MAX_QUOTE_SEARCH_LENGTH, {
    message: `La búsqueda no puede superar ${MAX_QUOTE_SEARCH_LENGTH} caracteres`,
  })
  @NoNulChars()
  q?: string;
}
