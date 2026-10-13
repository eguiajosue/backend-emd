import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Inicia la subida de un archivo de producción (sólo metadatos, sin bytes). */
export class InitProductionUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName: string;

  @IsString()
  @MaxLength(150)
  mimeType: string;

  /** Tamaño en bytes (Number alcanza: 2^53 ≫ cualquier archivo real). */
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  sizeBytes: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** Pide URLs nuevas para ciertas partes (las anteriores expiraron o fallaron). */
export class SignProductionPartsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  @Min(1, { each: true })
  partNumbers: number[];
}

export class CompletedPartDto {
  @IsInt()
  @Min(1)
  partNumber: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  etag: string;
}

/** Cierra la subida con el ETag de cada parte que subió el navegador. */
export class CompleteProductionUploadDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => CompletedPartDto)
  parts: CompletedPartDto[];
}
