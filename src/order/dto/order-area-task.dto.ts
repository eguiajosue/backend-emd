import { AreaTaskStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
} from 'class-validator';
import { PRODUCTION_AREAS } from './create-order.dto';

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
