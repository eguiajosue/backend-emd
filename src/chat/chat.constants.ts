import { Role } from 'src/common/enums/roles.enum';
import { OPERATIONAL_ROLES } from 'src/order/role-stage-mapping';

/**
 * Áreas operativas que tienen un canal fijo con Recepción. Es exactamente la
 * lista de roles operativos del flujo de pedidos, para no duplicar la
 * definición de "área".
 */
export const CHAT_AREAS: string[] = OPERATIONAL_ROLES.map((r) => r as string);

/**
 * Roles que participan de TODAS las conversaciones (canales y DMs) para
 * monitoreo. Sigue la convención de visibilidad total del resto del
 * codebase, pero SIN incluir a `recepcion`: Recepción participa de todos los
 * canales de área por diseño del producto, pero no de los DMs ajenos.
 */
export const CHAT_MONITOR_ROLES: string[] = [Role.ADMIN, Role.SUPERUSER];

/** Etiquetas en español de cada área, para el título del canal. */
export const CHAT_AREA_LABELS: Record<string, string> = {
  [Role.TALLER]: 'Taller',
  [Role.DTF]: 'DTF',
  [Role.BORDADO]: 'Bordado',
  [Role.DISENO]: 'Diseño',
  [Role.LASER]: 'Láser',
  [Role.IMPRESIONES]: 'Impresiones',
};

export const CHAT_CONVERSATION_TYPE_AREA = 'area';
export const CHAT_CONVERSATION_TYPE_DIRECT = 'direct';

/** Longitud máxima de un mensaje de chat. */
export const MAX_CHAT_MESSAGE_LENGTH = 2000;

export function isMonitorRole(roles: string[] | undefined): boolean {
  return (roles ?? []).some((r) => CHAT_MONITOR_ROLES.includes(r));
}

export function chatAreaLabel(area: string | null): string {
  if (!area) return 'Área';
  return CHAT_AREA_LABELS[area] ?? area;
}
