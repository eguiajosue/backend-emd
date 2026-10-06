import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import {
  isMockupColors,
  isNavPreferences,
} from './dto/user-preferences-shapes';

/**
 * Guardia de las preferencias que se guardan en columnas Json del usuario
 * (decisión R4 de frontend-emd/docs/plans/sidebar-y-mockups-v2.md). El
 * DTO ya valida la forma; esto repite la forma (el service también se usa
 * sin el pipe) y agrega topes que valen para TODAS las preferencias Json,
 * presentes y futuras: cada una se devuelve en cada GET de preferencias, así
 * que no puede crecer hasta el límite del body (10MB).
 */

/** Preferencias guardadas en columnas `Json?` de `User`. */
export const JSON_PREFERENCE_KEYS = [
  'frequentProductIds',
  'navPreferences',
  'mockupColors',
] as const satisfies readonly (keyof UpdateUserPreferencesDto)[];
export type JsonPreferenceKey = (typeof JSON_PREFERENCE_KEYS)[number];

/** Tope de cada preferencia Json serializada. */
export const MAX_JSON_PREFERENCE_BYTES = 8 * 1024;

/** Claves que nunca se guardan (contaminación de prototipos al leerlas). */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Forma de cada preferencia Json (la misma que exige el DTO). */
const SHAPES: Record<JsonPreferenceKey, (value: unknown) => boolean> = {
  frequentProductIds: (value) =>
    Array.isArray(value) &&
    value.length <= 50 &&
    value.every((id) => Number.isInteger(id) && id >= 1),
  navPreferences: isNavPreferences,
  mockupColors: isMockupColors,
};

function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (typeof value !== 'object' || value === null) return false;
  return Object.keys(value).some(
    (key) =>
      FORBIDDEN_KEYS.has(key) ||
      hasForbiddenKey((value as Record<string, unknown>)[key]),
  );
}

/**
 * Valida cada preferencia Json que venga con valor (no `undefined` ni
 * `null`): forma (400), claves prohibidas en cualquier nivel (400), NUL
 * (400: jsonb de Postgres no lo acepta) y ≤ 8KB serializada (413).
 */
export function assertJsonPreferencesValid(dto: UpdateUserPreferencesDto) {
  for (const key of JSON_PREFERENCE_KEYS) {
    const value: unknown = dto[key];
    if (value === undefined || value === null) continue;

    if (!SHAPES[key](value) || hasForbiddenKey(value)) {
      throw new HttpException(
        `La preferencia ${key} no tiene un formato válido`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const json = JSON.stringify(value);
    if (json.includes('\\u0000')) {
      throw new HttpException(
        `La preferencia ${key} tiene caracteres inválidos`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (Buffer.byteLength(json) > MAX_JSON_PREFERENCE_BYTES) {
      throw new HttpException(
        `La preferencia ${key} no puede superar ${MAX_JSON_PREFERENCE_BYTES / 1024}KB`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
  }
}

/**
 * Prisma no acepta `null` literal en una columna Json: cada preferencia Json
 * que llega en `null` se traduce a NULL de base (`Prisma.DbNull`), que el
 * frontend lee como "volver al valor por defecto".
 */
export function jsonPreferencesNullToDbNull(
  dto: UpdateUserPreferencesDto,
): Partial<Record<JsonPreferenceKey, typeof Prisma.DbNull>> {
  const data: Partial<Record<JsonPreferenceKey, typeof Prisma.DbNull>> = {};
  for (const key of JSON_PREFERENCE_KEYS) {
    if (dto[key] === null) data[key] = Prisma.DbNull;
  }
  return data;
}
