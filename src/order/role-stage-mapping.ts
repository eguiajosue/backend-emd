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

/**
 * Mapea cada rol operativo a los nombres de Status (ver Status.name en la DB)
 * que le corresponden. Portado 1:1 desde
 * frontend-emd/src/lib/roleTaskMapping.ts (que usa statusId sobre los 5
 * estados sembrados en prisma/seed.ts: 1=pendiente, 2=en pruebas,
 * 3=en proceso, 4=terminado, 5=entregado).
 *
 * Se usa el nombre del status (no el id) para no depender de que los ids
 * autoincrementales coincidan entre entornos.
 */
export const roleStageMapping: Record<string, string[]> = {
  [Role.TALLER]: ['en proceso'],
  [Role.DTF]: ['en proceso'],
  [Role.BORDADO]: ['en proceso'],
  [Role.DISENO]: ['en pruebas'],
  [Role.LASER]: ['en proceso'],
  [Role.IMPRESIONES]: ['en proceso'],
};

export function isFullVisibilityRole(roles: string[] | undefined): boolean {
  if (!roles) return false;
  return roles.some((r) => FULL_VISIBILITY_ROLES.includes(r as Role));
}

export function operationalRolesOf(roles: string[] | undefined): string[] {
  if (!roles) return [];
  return roles.filter((r) => OPERATIONAL_ROLES.includes(r as Role));
}
