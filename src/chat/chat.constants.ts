import { Role } from 'src/common/enums/roles.enum';

/**
 * Roles que participan de TODAS las conversaciones (canales y DMs) para
 * monitoreo. Sigue la convención de visibilidad total del resto del
 * codebase, pero SIN incluir a `recepcion`: Recepción participa de todos los
 * canales de área por diseño del producto, pero no de los DMs ajenos.
 */
export const CHAT_MONITOR_ROLES: string[] = [Role.ADMIN, Role.SUPERUSER];

export const CHAT_CONVERSATION_TYPE_AREA = 'area';
export const CHAT_CONVERSATION_TYPE_DIRECT = 'direct';

/** Longitud máxima de un mensaje de chat. */
export const MAX_CHAT_MESSAGE_LENGTH = 2000;

export function isMonitorRole(roles: string[] | undefined): boolean {
  return (roles ?? []).some((r) => CHAT_MONITOR_ROLES.includes(r));
}
