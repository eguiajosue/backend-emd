import { RestockRequestStatus, RestockRequestUrgency } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EmptyToUndefined,
  TrimString,
} from 'src/common/transformers/empty-to-undefined';
import { INVENTORY_AREAS } from '../inventory.constants';

/**
 * Aviso "se acabó / requiere reabasto". Se indica un artículo del inventario
 * del área (`itemId`) o, si todavía no existe, el nombre en texto libre
 * (`itemName`). `area` sólo hace falta con texto libre y más de un área.
 */
export class CreateRestockRequestDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  itemId?: number;

  @TrimString()
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(200)
  itemName?: string;

  @IsOptional()
  @IsIn(INVENTORY_AREAS)
  area?: (typeof INVENTORY_AREAS)[number];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity?: number;

  @TrimString()
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(50)
  unit?: string;

  @TrimString()
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(500)
  comment?: string;

  @IsOptional()
  @IsEnum(RestockRequestUrgency)
  urgency?: RestockRequestUrgency;
}

/** Recepción/admin mueven la solicitud: pendiente → en camino/comprado → resuelto. */
export class UpdateRestockRequestStatusDto {
  @IsEnum(RestockRequestStatus)
  status: RestockRequestStatus;

  @TrimString()
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class RestockRequestsQueryDto {
  @IsOptional()
  @IsEnum(RestockRequestStatus)
  status?: RestockRequestStatus;

  /** `true`: sólo las abiertas (todo menos RESUELTO). */
  @IsOptional()
  @IsIn(['true', 'false'])
  open?: 'true' | 'false';

  @IsOptional()
  @IsIn(INVENTORY_AREAS)
  area?: (typeof INVENTORY_AREAS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
