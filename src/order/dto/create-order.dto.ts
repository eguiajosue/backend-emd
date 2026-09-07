import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
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
  // El catálogo de productos se retiró: la línea del pedido siempre lleva el
  // nombre escrito a mano o elegido de un preset. Antes `customName` era
  // opcional porque podía venir un `productId` en su lugar.
  @TrimString()
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  customName: string;

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

/** Áreas de producción válidas como destino final de un pedido: ORDER_AREAS
 * sin 'diseno' (Diseño es una fase previa, no un destino de producción). */
export const PRODUCTION_AREAS = [
  'taller',
  'dtf',
  'bordado',
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

  // El creador real del pedido lo determina el servidor a partir del token
  // (ver OrderController.create) -- opcional acá para no romper la
  // validación si el cliente lo omite o lo manda mal.
  @IsOptional()
  @IsInt()
  @IsPositive()
  userId?: number;

  // Requerida sólo cuando el pedido NO pasa por Diseño (requiresDesign en
  // false): en ese caso hay que saber a qué área operativa va directo. Si
  // requiresDesign es true (default), el área se define después vía
  // `productionArea`, así que puede venir ausente.
  @ValidateIf(
    (dto: CreateOrderDto) =>
      dto.requiresDesign === false || dto.area !== undefined,
  )
  @IsNotEmpty({ message: 'area es requerida cuando requiresDesign es false' })
  @IsIn(ORDER_AREAS)
  area?: (typeof ORDER_AREAS)[number];

  // Con montaje (requiresDesign !== false) el pedido arranca en Diseño y
  // necesita responsable sí o sí: un diseñador concreto o la cuenta compartida
  // del área Diseño ("Cualquier diseñador"). Ver WORKFLOW.md §1.a. Sin montaje
  // la asignación sigue siendo opcional.
  @ValidateIf(
    (dto: CreateOrderDto) =>
      dto.requiresDesign !== false || dto.assignedUserId !== undefined,
  )
  @IsNotEmpty({
    message:
      'assignedUserId es requerido cuando el pedido requiere diseño (un diseñador o la cuenta del área Diseño)',
  })
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

  // Si el pedido pasa por la fase de Diseño antes de producción. Default
  // true (comportamiento nuevo); Recepción puede desmarcarlo para ir
  // directo a producción (comportamiento anterior, intacto).
  @IsOptional()
  @IsBoolean()
  requiresDesign?: boolean = true;

  // Área de producción destino una vez autorizado el diseño. Puede venir
  // vacía al crear (se define después, por Recepción o por Diseño).
  @IsOptional()
  @IsIn(PRODUCTION_AREAS)
  productionArea?: (typeof PRODUCTION_AREAS)[number];

  // Áreas de producción que van a trabajar el pedido. Un pedido puede necesitar
  // varias (ej. bordado + dtf) y todas avanzan en paralelo, cada una con su
  // propia tarea (ver WORKFLOW.md §3). `productionArea` (singular) se mantiene
  // como el destino "principal" para compatibilidad.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRODUCTION_AREAS.length)
  @IsIn(PRODUCTION_AREAS, { each: true })
  productionAreas?: (typeof PRODUCTION_AREAS)[number][];
}
