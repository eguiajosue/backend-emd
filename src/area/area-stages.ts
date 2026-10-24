import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AREA_SLUG_MAX_LENGTH, slugifyAreaName } from './area-access';

/**
 * Etapas previas a producción de un área (ver model AreaStage y
 * docs/areas.md). Aquí vive la parte pura: forma de las etapas, reglas de la
 * lista y cómo se pasa de una a otra.
 */
export type AreaStageKind = 'work' | 'review';

export const AREA_STAGE_KINDS: readonly AreaStageKind[] = ['work', 'review'];
export const MAX_AREA_STAGES = 6;
export const STAGE_NAME_MIN_LENGTH = 2;
export const STAGE_NAME_MAX_LENGTH = 40;

/** Una etapa activa, como la ve el resto de la app. */
export interface AreaStageView {
  id: number;
  key: string;
  name: string;
  kind: AreaStageKind;
}

/** Lo que el administrador captura de cada etapa (el orden es el de la lista). */
export interface StageDraft {
  /** Id de una etapa que ya existe; sin id = etapa nueva. */
  id?: number;
  name: string;
  kind: AreaStageKind;
}

export const AREA_STAGE_SELECT = {
  id: true,
  key: true,
  name: true,
  kind: true,
} as const;

/** Sólo las etapas activas, en orden: lo que va dentro de `AREA_SELECT`. */
export const AREA_STAGES_INCLUDE = {
  where: { active: true },
  orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  select: AREA_STAGE_SELECT,
} satisfies Prisma.Area$stagesArgs;

/**
 * Reglas de la lista de etapas de un área:
 * - hasta `MAX_AREA_STAGES`, con nombres distintos (sin importar mayúsculas);
 * - la primera es de trabajo: una tarea nace en ella y una revisión necesita
 *   algo que revisar;
 * - no hay dos revisiones seguidas: al rechazar, la tarea regresa a la etapa
 *   anterior, que tiene que ser de trabajo.
 */
export function assertValidStageList(stages: readonly StageDraft[]) {
  if (stages.length > MAX_AREA_STAGES) {
    throw new BadRequestException(
      `Un área puede tener hasta ${MAX_AREA_STAGES} etapas`,
    );
  }
  const seen = new Set<string>();
  stages.forEach((stage, index) => {
    const name = stage.name.trim();
    if (
      name.length < STAGE_NAME_MIN_LENGTH ||
      name.length > STAGE_NAME_MAX_LENGTH
    ) {
      throw new BadRequestException(
        `El nombre de cada etapa debe tener entre ${STAGE_NAME_MIN_LENGTH} y ${STAGE_NAME_MAX_LENGTH} caracteres`,
      );
    }
    const normalized = name.toLowerCase();
    if (seen.has(normalized)) {
      throw new BadRequestException(`La etapa "${name}" está repetida`);
    }
    seen.add(normalized);
    if (stage.kind === 'review') {
      if (index === 0) {
        throw new BadRequestException(
          `La primera etapa no puede ser una revisión ("${name}"): no habría nada que revisar`,
        );
      }
      if (stages[index - 1].kind === 'review') {
        throw new BadRequestException(
          `"${name}" no puede ir justo después de otra revisión`,
        );
      }
    }
  });
}

/** Clave estable de una etapa nueva: el slug del nombre, sin repetir las usadas. */
export function stageKeyFor(name: string, taken: ReadonlySet<string>): string {
  const base = slugifyAreaName(name).slice(0, AREA_SLUG_MAX_LENGTH) || 'etapa';
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  return key;
}

/** La etapa que sigue a `current` (o la primera si es null); null = producción. */
export function nextStage<T extends { id: number }>(
  stages: readonly T[],
  current: { id: number } | null,
): T | null {
  if (!current) return stages[0] ?? null;
  const index = stages.findIndex((stage) => stage.id === current.id);
  return index === -1 ? null : (stages[index + 1] ?? null);
}

/** La etapa anterior a `current`; null si es la primera. */
export function previousStage<T extends { id: number }>(
  stages: readonly T[],
  current: { id: number },
): T | null {
  const index = stages.findIndex((stage) => stage.id === current.id);
  return index > 0 ? stages[index - 1] : null;
}
