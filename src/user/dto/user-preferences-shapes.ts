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
  /**
   * Orden propio, plano: urls en el orden elegido. Cada grupo ordena sus
   * ítems por su posición en esta lista; los que no están quedan al final
   * de su grupo en el orden por defecto. Plano y no por grupo (decisión R1):
   * los nombres de grupo cambian según el menú del rol y al renombrarlos.
   */
  order: string[];
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

/** Tope de `favorites` y de `hidden`. */
export const MAX_NAV_LIST_ITEMS = 50;
/** Tope de `order` (puede listar todos los ítems del menú). */
export const MAX_NAV_ORDER_ITEMS = 100;
export const MAX_NAV_URL_LENGTH = 200;
export const MAX_MOCKUP_COLORS = 48;

const NAV_URL = /^\/dashboard[^\u0000-\u001f\u007f]*$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

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

function isNavUrlList(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every(isNavUrl);
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
  return (
    isNavUrlList(value.favorites, MAX_NAV_LIST_ITEMS) &&
    isNavUrlList(value.hidden, MAX_NAV_LIST_ITEMS) &&
    isNavUrlList(value.order, MAX_NAV_ORDER_ITEMS) &&
    typeof value.expanded === 'boolean'
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
          `navPreferences debe ser { favorites: string[]; order: string[]; hidden: string[]; expanded: boolean } con urls de /dashboard (máx. ${MAX_NAV_URL_LENGTH} caracteres; ${MAX_NAV_LIST_ITEMS} favoritos u ocultos, ${MAX_NAV_ORDER_ITEMS} en order)`,
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
