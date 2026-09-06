import { Role } from 'src/common/enums/roles.enum';

/**
 * Roles operativos/de producción que comparten etapas del flujo de pedido.
 * Corresponde 1:1 con OPERATIONAL_ROLES en frontend-emd/src/lib/roleTaskMapping.ts.
 */
export const OPERATIONAL_ROLES: Role[] = [
  Role.TALLER,
  Role.DTF,
  Role.BORDADO,
  Role.DISENO,
  Role.LASER,
  Role.IMPRESIONES,
];

/**
 * Roles con acceso administrativo total: siempre ven todos los pedidos sin filtrar.
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

export function operationalRolesOf(roles: string[] | undefined): string[] {
  if (!roles) return [];
  return roles.filter((r) => OPERATIONAL_ROLES.includes(r as Role));
}
