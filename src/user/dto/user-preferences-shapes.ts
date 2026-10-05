import { ValidateBy, ValidationOptions } from 'class-validator';

/**
 * Formas de las preferencias Json del usuario (`navPreferences`,
 * `mockupColors`). Se validan con un validador propio y no con
 * `@ValidateNested`: son objetos chicos de forma fija y así el mensaje de
 * error es uno solo y claro. Se rechazan claves de más (igual que haría
 * `forbidNonWhitelisted`) para no guardar basura arbitraria en la columna.
 */

/**
 * Barra lateral del frontend (`lib/navPreferences.ts`). `type` y no
 * `interface` a propósito: así es asignable a `Prisma.InputJsonObject`.
 */
export type NavPreferences = {
  /** Urls de los ítems fijados arriba, en el orden elegido. */
  favorites: string[];
  /** Por grupo (`groupLabel` del menú): urls de sus ítems en el orden elegido. */
  order: Record<string, string[]>;
  /** Urls de los ítems ocultos. */
  hidden: string[];
  /** Barra expandida (títulos visibles). */
  expanded: boolean;
};

/** "Mis colores" del creador de mockups. */
export type MockupColors = {
  favorites: string[];
  custom: string[];
};

export const MAX_NAV_LIST_ITEMS = 50;
export const MAX_NAV_GROUPS = 20;
export const MAX_NAV_GROUP_KEY_LENGTH = 80;
export const MAX_NAV_URL_LENGTH = 200;
export const MAX_MOCKUP_COLORS = 48;

const NAV_URL = /^\/dashboard[^\u0000-\u001f\u007f]*$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function isNavUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_NAV_URL_LENGTH &&
    NAV_URL.test(value)
  );
}

function isNavUrlList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_NAV_LIST_ITEMS &&
    value.every(isNavUrl)
  );
}

function isColorList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_MOCKUP_COLORS &&
    value.every((color) => typeof color === 'string' && HEX_COLOR.test(color))
  );
}

export function isNavPreferences(value: unknown): value is NavPreferences {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['favorites', 'order', 'hidden', 'expanded'])
  ) {
    return false;
  }
  if (!isNavUrlList(value.favorites) || !isNavUrlList(value.hidden)) {
    return false;
  }
  if (typeof value.expanded !== 'boolean') return false;
  if (!isPlainObject(value.order)) return false;
  const groups = Object.entries(value.order);
  return (
    groups.length <= MAX_NAV_GROUPS &&
    groups.every(
      ([group, urls]) =>
        group.trim().length > 0 &&
        group.length <= MAX_NAV_GROUP_KEY_LENGTH &&
        !CONTROL_CHARS.test(group) &&
        isNavUrlList(urls),
    )
  );
}

export function isMockupColors(value: unknown): value is MockupColors {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ['favorites', 'custom']) &&
    isColorList(value.favorites) &&
    isColorList(value.custom)
  );
}

/** `navPreferences` con la forma de `NavPreferences` (null lo resuelve `@IsOptional`). */
export function IsNavPreferences(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isNavPreferences',
      validator: {
        validate: (value) => isNavPreferences(value),
        defaultMessage: () =>
          `navPreferences debe ser { favorites: string[]; order: Record<string, string[]>; hidden: string[]; expanded: boolean } con urls de /dashboard (máx. ${MAX_NAV_URL_LENGTH} caracteres, ${MAX_NAV_LIST_ITEMS} por lista, ${MAX_NAV_GROUPS} grupos)`,
      },
    },
    validationOptions,
  );
}

/** `mockupColors` con la forma de `MockupColors` (null lo resuelve `@IsOptional`). */
export function IsMockupColors(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isMockupColors',
      validator: {
        validate: (value) => isMockupColors(value),
        defaultMessage: () =>
          `mockupColors debe ser { favorites: string[]; custom: string[] } con colores #rrggbb (máx. ${MAX_MOCKUP_COLORS} cada lista)`,
      },
    },
    validationOptions,
  );
}
