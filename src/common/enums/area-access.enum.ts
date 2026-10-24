import {
  areasOf,
  belongsToArea,
  DESIGN_AREA,
  EMBROIDERY_AREA,
  productionAreasOf,
  type AreaMember,
} from 'src/area/area-access';
import { Role } from './roles.enum';

/**
 * Acceso por pertenencia a un área, para usar en `@Auth(...)` junto a los
 * roles: `@Auth(Role.RECEPCION, AreaAccess.PRODUCTION)` deja pasar a
 * Recepción y a quien trabaje en cualquier área de producción.
 */
export enum AreaAccess {
  /** Cualquier área, Diseño incluido. */
  ANY = 'area:*',
  /** Cualquier área de producción (todas menos Diseño). */
  PRODUCTION = 'area:produccion',
  /** El área de Diseño. */
  DESIGN = 'area:diseno',
  /** El área de Bordado (etapas de digitalizado y pruebas). */
  EMBROIDERY = 'area:bordado',
}

/** Lo que acepta `@Auth(...)`: un rol o un acceso por área. */
export type Access = Role | AreaAccess;

const AREA_ACCESS_VALUES = new Set<string>(Object.values(AreaAccess));

export function isAreaAccess(access: string): access is AreaAccess {
  return AREA_ACCESS_VALUES.has(access);
}

export function hasAreaAccess(
  user: AreaMember | undefined | null,
  access: AreaAccess,
): boolean {
  switch (access) {
    case AreaAccess.ANY:
      return areasOf(user).length > 0;
    case AreaAccess.PRODUCTION:
      return productionAreasOf(user).length > 0;
    case AreaAccess.DESIGN:
      return belongsToArea(user, DESIGN_AREA);
    case AreaAccess.EMBROIDERY:
      return belongsToArea(user, EMBROIDERY_AREA);
  }
}

/** Si la sesión cumple alguno de los accesos pedidos. */
export function satisfiesAccess(
  user: AreaMember | undefined | null,
  required: readonly Access[],
): boolean {
  const roles = user?.roles ?? [];
  return required.some((access) =>
    isAreaAccess(access) ? hasAreaAccess(user, access) : roles.includes(access),
  );
}
