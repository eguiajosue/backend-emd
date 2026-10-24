import { AreaTaskStatus, SampleTestResult } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MAX_ORDER_AREAS, OrderFileDto } from './create-order.dto';
import { IsAreaSlug } from 'src/area/is-area-slug.decorator';

/** Áreas de producción que van a trabajar un pedido (WORKFLOW.md §3). */
export class SetOrderAreasDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_ORDER_AREAS)
  @IsAreaSlug({ each: true })
  areas: string[];
}

/** Avance de una tarea: pendiente → en_proceso → terminado. */
export class UpdateAreaTaskStatusDto {
  @IsEnum(AreaTaskStatus)
  status: AreaTaskStatus;
}

/** Máquina del área que trabaja la tarea; `null` la quita. */
export class SetAreaTaskMachineDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  machineId?: number | null;
}

/** Datos propios del área capturados en la tarea: { [clave]: valor }; null o "" borra el dato. */
export class SetAreaTaskFieldsDto {
  @IsObject()
  values: Record<string, unknown>;
}

/** Responsable de una tarea. `null` la deja libre para que la tome el área. */
export class AssignAreaTaskDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  assignedUserId?: number | null;
}

/** Pasar la tarea a la siguiente etapa; en Bordado, mandar la digitalización a pruebas (WORKFLOW.md §3.1). */
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

/** Resultado de la revisión abierta (en Bordado, la prueba). */
export class SampleTestResultDto {
  @IsEnum(SampleTestResult)
  result: SampleTestResult;

  /** Obligatoria al rechazar: qué hay que corregir. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
