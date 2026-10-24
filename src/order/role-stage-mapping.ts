import { Role } from 'src/common/enums/roles.enum';

/**
 * Roles con acceso administrativo total: siempre ven todos los pedidos sin filtrar.
 * Quién trabaja en qué área ya no es un rol: ver `areasOf` en
 * src/area/area-access.ts.
 */
export const FULL_VISIBILITY_ROLES: Role[] = [
  Role.ADMIN,
  Role.SUPERUSER,
  Role.RECEPCION,
];

export function isFullVisibilityRole(roles: string[] | undefined): boolean {
  if (!roles) return false;
  return roles.some((r) => FULL_VISIBILITY_ROLES.includes(r as Role));
}
