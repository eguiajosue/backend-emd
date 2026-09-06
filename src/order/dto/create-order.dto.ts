import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  EmptyToUndefined,
  TrimString,
} from 'src/common/transformers/empty-to-undefined';

/** Mime types permitidos para la hoja de autorización del pedido. */
export const AUTHORIZATION_FILE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'application/pdf',
] as const;

export class AuthorizationFileDto {
  /** Contenido del archivo en base64, SIN el prefijo `data:...;base64,`. */
  @IsNotEmpty()
  @IsString()
  data: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  filename: string;

  @IsNotEmpty()
  @IsIn(AUTHORIZATION_FILE_MIME_TYPES)
  mimeType: string;
}

export class OrderProductDto {
  @IsNotEmpty()
  @IsInt()
  @IsPositive()
  productId: number;

  @IsNotEmpty()
  @IsInt()
  @Min(1, { message: 'La cantidad debe ser al menos 1' })
  quantity: number;
}

/** Áreas/departamentos operativos válidos para un pedido. Coincide 1:1 con
 * los roles operativos (ver Role en roles.enum.ts) y con
 * AreaVisibilitySetting.role. */
export const ORDER_AREAS = [
  'taller',
  'dtf',
  'bordado',
  'diseno',
  'laser',
  'impresiones',
] as const;

export class CreateOrderDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  clientId?: number;

  @TrimString()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientNameOverride?: string;

  @IsNotEmpty()
  @IsInt()
  @IsPositive()
  userId: number;

  @IsNotEmpty()
  @IsIn(ORDER_AREAS)
  area: (typeof ORDER_AREAS)[number];

  @IsOptional()
  @IsInt()
  @IsPositive()
  assignedUserId?: number;

  @IsNotEmpty()
  @IsInt()
  @IsPositive()
  statusId: number = 1;

  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  description: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderProductDto)
  orderProducts?: OrderProductDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AuthorizationFileDto)
  authorizationFile?: AuthorizationFileDto;
}
