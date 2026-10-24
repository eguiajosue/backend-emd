import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Configuración de un área que se captura en el wizard: máquinas y datos
 * propios de cada tarea (ver model AreaMachine y AreaField). Aquí vive la
 * parte pura: forma, reglas de las listas y validación de los valores.
 */
export type AreaFieldType = 'text' | 'number' | 'select' | 'boolean';
export const AREA_FIELD_TYPES: readonly AreaFieldType[] = [
  'text',
  'number',
  'select',
  'boolean',
];

export const MAX_AREA_MACHINES = 12;
export const MAX_AREA_FIELDS = 10;
export const MAX_FIELD_OPTIONS = 10;
export const CONFIG_NAME_MIN_LENGTH = 2;
export const CONFIG_NAME_MAX_LENGTH = 40;
export const FIELD_TEXT_MAX_LENGTH = 200;
export const MAX_CAPACITY = 500;
export const MAX_TURNAROUND_HOURS = 720;

export const AREA_MACHINE_SELECT = { id: true, name: true } as const;
export const AREA_FIELD_SELECT = {
  id: true,
  key: true,
  label: true,
  type: true,
  required: true,
  options: true,
  unit: true,
} as const;

/** Sólo lo activo y en orden: lo que va dentro de `AREA_SELECT`. */
export const AREA_MACHINES_INCLUDE = {
  where: { active: true },
  orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  select: AREA_MACHINE_SELECT,
} satisfies Prisma.Area$machinesArgs;
export const AREA_FIELDS_INCLUDE = {
  where: { active: true },
  orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  select: AREA_FIELD_SELECT,
} satisfies Prisma.Area$fieldsArgs;

export interface AreaMachineView {
  id: number;
  name: string;
}

export interface AreaFieldView {
  id: number;
  key: string;
  label: string;
  type: AreaFieldType;
  required: boolean;
  options: string[];
  unit: string | null;
}

/** Una máquina como se captura: sin `id` es nueva. */
export interface MachineDraft {
  id?: number;
  name: string;
}

/** Un dato propio como se captura: sin `id` es nuevo; el tipo no cambia después. */
export interface FieldDraft {
  id?: number;
  label: string;
  type: AreaFieldType;
  required?: boolean;
  options?: string[];
  unit?: string;
}

export type FieldValue = string | number | boolean;
export type FieldValues = Record<string, FieldValue>;

function assertNames(
  names: readonly string[],
  what: string,
  max: number,
): void {
  if (names.length > max) {
    throw new BadRequestException(`Un área puede tener hasta ${max} ${what}`);
  }
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (
      name.length < CONFIG_NAME_MIN_LENGTH ||
      name.length > CONFIG_NAME_MAX_LENGTH
    ) {
      throw new BadRequestException(
        `El nombre debe tener entre ${CONFIG_NAME_MIN_LENGTH} y ${CONFIG_NAME_MAX_LENGTH} caracteres`,
      );
    }
    if (seen.has(name.toLowerCase())) {
      throw new BadRequestException(`"${name}" está repetido`);
    }
    seen.add(name.toLowerCase());
  }
}

export function assertValidMachineList(machines: readonly MachineDraft[]) {
  assertNames(
    machines.map((m) => m.name),
    'máquinas',
    MAX_AREA_MACHINES,
  );
}

export function assertValidFieldList(fields: readonly FieldDraft[]) {
  assertNames(
    fields.map((f) => f.label),
    'datos propios',
    MAX_AREA_FIELDS,
  );
  for (const field of fields) {
    const label = field.label.trim();
    const options = (field.options ?? []).map((o) => o.trim());
    if (field.type === 'select') {
      if (options.length < 2 || options.length > MAX_FIELD_OPTIONS) {
        throw new BadRequestException(
          `"${label}" necesita entre 2 y ${MAX_FIELD_OPTIONS} opciones`,
        );
      }
      if (
        options.some((o) => !o || o.length > CONFIG_NAME_MAX_LENGTH) ||
        new Set(options.map((o) => o.toLowerCase())).size !== options.length
      ) {
        throw new BadRequestException(
          `Las opciones de "${label}" deben ser distintas y de hasta ${CONFIG_NAME_MAX_LENGTH} caracteres`,
        );
      }
    } else if (options.length > 0) {
      throw new BadRequestException(
        `Sólo los datos de tipo lista llevan opciones ("${label}")`,
      );
    }
    if (field.unit && field.type !== 'number') {
      throw new BadRequestException(
        `Sólo los datos numéricos llevan unidad ("${label}")`,
      );
    }
    if (field.type === 'boolean' && field.required) {
      throw new BadRequestException(
        `"${label}" es de sí/no: no puede ser obligatorio`,
      );
    }
  }
}

/** Valida los valores capturados contra los datos activos del área. */
export function validateFieldValues(
  fields: readonly AreaFieldView[],
  values: Record<string, unknown>,
): FieldValues {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const clean: FieldValues = {};
  for (const [key, raw] of Object.entries(values)) {
    const field = byKey.get(key);
    if (!field) {
      throw new BadRequestException(`El dato "${key}" no existe en esta área`);
    }
    if (raw === null || raw === '') continue; // vacío = sin valor
    switch (field.type) {
      case 'text': {
        if (typeof raw !== 'string' || raw.length > FIELD_TEXT_MAX_LENGTH) {
          throw new BadRequestException(
            `"${field.label}" debe ser texto de hasta ${FIELD_TEXT_MAX_LENGTH} caracteres`,
          );
        }
        clean[key] = raw.trim();
        break;
      }
      case 'number': {
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
          throw new BadRequestException(`"${field.label}" debe ser un número`);
        }
        clean[key] = raw;
        break;
      }
      case 'select': {
        if (typeof raw !== 'string' || !field.options.includes(raw)) {
          throw new BadRequestException(
            `"${field.label}" debe ser una de: ${field.options.join(', ')}`,
          );
        }
        clean[key] = raw;
        break;
      }
      case 'boolean': {
        if (typeof raw !== 'boolean') {
          throw new BadRequestException(`"${field.label}" debe ser sí o no`);
        }
        clean[key] = raw;
        break;
      }
    }
  }
  return clean;
}

/** Datos obligatorios sin valor: no se puede empezar la producción sin ellos. */
export function missingRequired(
  fields: readonly AreaFieldView[],
  values: FieldValues | null | undefined,
): AreaFieldView[] {
  return fields.filter(
    (f) =>
      f.required && (values?.[f.key] === undefined || values[f.key] === ''),
  );
}
