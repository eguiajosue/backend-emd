/**
 * Reglas de pertenencia a un área (ver model Area y docs/areas.md).
 *
 * El rol dice QUÉ puede hacer una persona (admin, recepción, sucursal...); el
 * área dice DÓNDE trabaja. Las áreas de una sesión viajan en el JWT
 * (`AccessTokenPayload.areas`) como slugs de áreas activas.
 */

/**
 * Diseño es la fase previa al circuito de producción, con su propio flujo
 * (montaje → autorización). Sigue siendo un área especial: nunca es destino
 * de producción y no se crea desde el wizard.
 */
export const DESIGN_AREA = 'diseno';

/**
 * Bordado es la única área con etapas previas a producción (digitalizado →
 * pruebas, WORKFLOW.md §3.1). Las etapas configurables por área llegan en la
 * fase 3; mientras tanto el slug queda fijo aquí.
 */
export const EMBROIDERY_AREA = 'bordado';

/**
 * Bandeja de inventario que no es un área de trabajo: Recepción también tiene
 * existencias propias (papelería, empaques).
 */
export const RECEPTION_INVENTORY_AREA = 'recepcion';

/**
 * Slugs que no puede usar un área: chocan con los nombres de rol (salas de
 * socket, inventario de Recepción) o con rutas del frontend.
 */
export const RESERVED_AREA_SLUGS = [
  'admin',
  'superuser',
  'recepcion',
  'sucursal',
  'all',
  'todas',
] as const;

/** Slug válido: minúsculas ASCII, dígitos y guiones, de 2 a 40 caracteres. */
export const AREA_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const AREA_SLUG_MAX_LENGTH = 40;

/**
 * Roles que tenían las áreas antes de separarlas (migración
 * 20261024120000_areas_catalog). Sólo se usan para leer access tokens
 * emitidos antes del despliegue (ver `normalizeAccessPayload`); se puede
 * borrar una vez vencidos (JWT_REFRESH_EXPIRES_IN, 7 días por defecto).
 */
export const LEGACY_AREA_ROLES = [
  'taller',
  'dtf',
  'bordado',
  'diseno',
  'laser',
  'impresiones',
] as const;

/** Lo mínimo de una sesión para decidir por área. */
export interface AreaMember {
  roles?: string[];
  areas?: string[];
}

/** Áreas de la sesión (vacío si no trabaja en ninguna). */
export function areasOf(user: AreaMember | undefined | null): string[] {
  return user?.areas ?? [];
}

/** Áreas de PRODUCCIÓN de la sesión: todas las suyas menos Diseño. */
export function productionAreasOf(
  user: AreaMember | undefined | null,
): string[] {
  return areasOf(user).filter((area) => area !== DESIGN_AREA);
}

export function belongsToArea(
  user: AreaMember | undefined | null,
  area: string | null | undefined,
): boolean {
  return !!area && areasOf(user).includes(area);
}

/**
 * Completa una sesión emitida antes de separar áreas y roles: esos tokens
 * traen las áreas dentro de `roles` y no tienen `areas`.
 */
export function normalizeAccessPayload<
  T extends { roles?: string[]; areas?: string[] },
>(payload: T): T & { roles: string[]; areas: string[] } {
  const roles = payload.roles ?? [];
  if (Array.isArray(payload.areas)) {
    return { ...payload, roles, areas: payload.areas };
  }
  const legacy = LEGACY_AREA_ROLES as readonly string[];
  return {
    ...payload,
    roles: roles.filter((role) => !legacy.includes(role)),
    areas: roles.filter((role) => legacy.includes(role)),
  };
}

/** Sala de socket de un área (separada de las salas por rol). */
export function areaRoom(area: string): string {
  return `area:${area}`;
}
