import { AreaTaskStatus, SampleTestResult } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PRODUCTION_AREAS, OrderFileDto } from './create-order.dto';

/** Áreas de producción que van a trabajar un pedido (WORKFLOW.md §3). */
export class SetOrderAreasDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(PRODUCTION_AREAS.length)
  @IsIn(PRODUCTION_AREAS, { each: true })
  areas: (typeof PRODUCTION_AREAS)[number][];
}

/** Avance de una tarea: pendiente → en_proceso → terminado. */
export class UpdateAreaTaskStatusDto {
  @IsEnum(AreaTaskStatus)
  status: AreaTaskStatus;
}

/** Responsable de una tarea. `null` la deja libre para que la tome el área. */
export class AssignAreaTaskDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  assignedUserId?: number | null;
}

/** Mandar la digitalización de Bordado a pruebas (WORKFLOW.md §3.1). */
export class SendToTestDto {
  /** Qué se corrigió o con qué parámetros se hace la prueba. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** Foto de la prueba hecha (PNG o JPEG, hasta 5MB), para que Recepción la revise. */
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderFileDto)
  photo?: OrderFileDto;
}

/** Resultado de la prueba de bordado abierta. */
export class SampleTestResultDto {
  @IsEnum(SampleTestResult)
  result: SampleTestResult;

  /** Obligatoria al rechazar: qué hay que corregir. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
