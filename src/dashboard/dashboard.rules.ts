/**
 * Reglas puras de los Inicio (sin Prisma): plazos, salud de un área y qué
 * pedidos requieren atención de Recepción. Las usa DashboardService y se
 * testean solas.
 */

const HOUR_MS = 3_600_000;

/** Igual que el frontend (lib/orderDeadline.ts): vence en menos de 48 h = "en riesgo". */
export const AT_RISK_WINDOW_MS = 48 * HOUR_MS;

/** Esperando autorización del cliente más de esto: Recepción debería llamarlo. */
export const WAITING_CLIENT_ALERT_MS = 48 * HOUR_MS;

/** Listo para entregar hace más de esto y sin entregar. */
export const READY_ALERT_MS = 24 * HOUR_MS;

/** Un trabajo sin empezar hace más de esto pone el área en amarillo. */
export const STALE_PENDING_MS = 24 * HOUR_MS;

export type DeadlineTone = 'overdue' | 'at_risk' | 'on_time' | 'no_date';

/** Plazo de un trabajo que todavía no está listo. */
export function deadlineTone(
  deliveryDate: Date | null,
  now: Date,
): DeadlineTone {
  if (!deliveryDate) return 'no_date';
  const remaining = deliveryDate.getTime() - now.getTime();
  if (remaining < 0) return 'overdue';
  if (remaining < AT_RISK_WINDOW_MS) return 'at_risk';
  return 'on_time';
}

export type AreaHealth = 'ok' | 'warning' | 'critical';

export function areaHealth(
  load: { overdue: number; atRisk: number; oldestWaitingSince: Date | null },
  now: Date,
): AreaHealth {
  if (load.overdue > 0) return 'critical';
  const stale =
    load.oldestWaitingSince !== null &&
    now.getTime() - load.oldestWaitingSince.getTime() > STALE_PENDING_MS;
  if (load.atRisk > 0 || stale) return 'warning';
  return 'ok';
}

export type AttentionReason =
  | 'overdue'
  | 'ready_not_delivered'
  | 'at_risk_not_started'
  | 'waiting_client'
  | 'changes_requested'
  | 'design_not_started'
  | 'no_date';

/** Orden de gravedad (0 = lo primero que hay que mirar). */
export const ATTENTION_RANK: Record<AttentionReason, number> = {
  overdue: 0,
  ready_not_delivered: 1,
  at_risk_not_started: 2,
  waiting_client: 3,
  changes_requested: 4,
  design_not_started: 5,
  no_date: 6,
};

/** Lo mínimo de un pedido activo para decidir si requiere atención. */
export interface AttentionInput {
  phase:
    | 'design_new'
    | 'design_working'
    | 'changes'
    | 'waiting_client'
    | 'production'
    | 'ready';
  deliveryDate: Date | null;
  creationDate: Date;
  /** Algo ya empezó (diseño abierto o alguna tarea en proceso/terminada). */
  started: boolean;
  /** Montaje enviado (esperando autorización) / feedback cargado (cambios). */
  lastSentAt: Date | null;
  lastFeedbackAt: Date | null;
  /** Desde cuándo está listo (última tarea terminada). */
  readySince: Date | null;
}

/**
 * Por qué un pedido activo necesita que Recepción lo mire (o null si va
 * bien), y desde cuándo. Un pedido tiene a lo sumo un motivo: el más grave.
 */
export function attentionFor(
  order: AttentionInput,
  now: Date,
): { reason: AttentionReason; since: Date | null } | null {
  const t = now.getTime();
  if (order.phase === 'ready') {
    const since = order.readySince;
    const overdue =
      order.deliveryDate !== null && order.deliveryDate.getTime() < t;
    if (overdue || (since && t - since.getTime() > READY_ALERT_MS)) {
      return { reason: 'ready_not_delivered', since };
    }
    return null;
  }
  const tone = deadlineTone(order.deliveryDate, now);
  if (tone === 'overdue')
    return { reason: 'overdue', since: order.deliveryDate };
  if (
    tone === 'at_risk' &&
    !order.started &&
    order.phase !== 'waiting_client'
  ) {
    return { reason: 'at_risk_not_started', since: order.deliveryDate };
  }
  if (
    order.phase === 'waiting_client' &&
    order.lastSentAt &&
    t - order.lastSentAt.getTime() > WAITING_CLIENT_ALERT_MS
  ) {
    return { reason: 'waiting_client', since: order.lastSentAt };
  }
  if (
    order.phase === 'changes' &&
    order.lastFeedbackAt &&
    t - order.lastFeedbackAt.getTime() > STALE_PENDING_MS
  ) {
    return { reason: 'changes_requested', since: order.lastFeedbackAt };
  }
  if (
    order.phase === 'design_new' &&
    t - order.creationDate.getTime() > STALE_PENDING_MS
  ) {
    return { reason: 'design_not_started', since: order.creationDate };
  }
  if (tone === 'no_date')
    return { reason: 'no_date', since: order.creationDate };
  return null;
}

/** Más grave primero; a igual gravedad, el que lleva más tiempo así. */
export function compareAttention(
  a: { reason: AttentionReason; since: Date | null },
  b: { reason: AttentionReason; since: Date | null },
): number {
  return (
    ATTENTION_RANK[a.reason] - ATTENTION_RANK[b.reason] ||
    (a.since?.getTime() ?? Infinity) - (b.since?.getTime() ?? Infinity)
  );
}
