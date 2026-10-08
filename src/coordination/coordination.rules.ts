/**
 * Cálculos puros del tablero de Coordinación (WORKFLOW.md §9): carga por
 * área y persona, tiempos por etapa y pedidos atrasados. Días en hora de
 * México: un pedido con entrega "hoy" no está atrasado hasta mañana.
 */

export const COORD_TZ = 'America/Mexico_City';
export const dayKey = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: COORD_TZ }).format(d);

export const DELAY_REASONS = [
  'material',
  'cliente',
  'retrabajo',
  'carga',
  'maquinaria',
  'otro',
] as const;
export type DelayReason = (typeof DELAY_REASONS)[number];

/** 'atrasado' (pasó el día de entrega), 'pronto' (hoy o mañana) o null. */
export function deadlineState(
  deliveryDate: Date | null,
  now: Date,
): 'atrasado' | 'pronto' | null {
  if (!deliveryDate) return null;
  const due = dayKey(deliveryDate);
  const today = dayKey(now);
  if (due < today) return 'atrasado';
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000));
  return due <= tomorrow ? 'pronto' : null;
}

/** Días completos de atraso (0 si no está atrasado). */
export function daysLate(deliveryDate: Date | null, now: Date): number {
  if (!deliveryDate) return 0;
  const a = Date.parse(dayKey(deliveryDate));
  const b = Date.parse(dayKey(now));
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export interface LoadTask {
  area: string;
  status: 'pendiente' | 'en_proceso' | 'terminado';
  assignedUserId: number | null;
  assigneeName: string | null;
  /** La cuenta compartida del área cuenta como "sin asignar a alguien". */
  sharedAccount: boolean;
  deliveryDate: Date | null;
}

export interface Counts {
  pendiente: number;
  enProceso: number;
  atrasadas: number;
  pronto: number;
}
const zero = (): Counts => ({
  pendiente: 0,
  enProceso: 0,
  atrasadas: 0,
  pronto: 0,
});

/** Carga abierta (sin lo terminado) por área y, dentro, por persona. */
export function loadByArea(
  tasks: LoadTask[],
  now: Date,
  areas: readonly string[],
) {
  const byArea = new Map<
    string,
    Counts & {
      sinPersona: number;
      people: Map<number, Counts & { userId: number; name: string }>;
    }
  >();
  for (const area of areas) {
    byArea.set(area, { ...zero(), sinPersona: 0, people: new Map() });
  }
  for (const t of tasks) {
    if (t.status === 'terminado') continue;
    const a = byArea.get(t.area);
    if (!a) continue;
    const state = deadlineState(t.deliveryDate, now);
    const bump = (c: Counts) => {
      if (t.status === 'pendiente') c.pendiente += 1;
      else c.enProceso += 1;
      if (state === 'atrasado') c.atrasadas += 1;
      if (state === 'pronto') c.pronto += 1;
    };
    bump(a);
    if (t.assignedUserId == null || t.sharedAccount) {
      a.sinPersona += 1;
      continue;
    }
    let p = a.people.get(t.assignedUserId);
    if (!p) {
      p = { ...zero(), userId: t.assignedUserId, name: t.assigneeName ?? '—' };
      a.people.set(t.assignedUserId, p);
    }
    bump(p);
  }
  return Array.from(byArea.entries()).map(([area, a]) => ({
    area,
    pendiente: a.pendiente,
    enProceso: a.enProceso,
    atrasadas: a.atrasadas,
    pronto: a.pronto,
    sinPersona: a.sinPersona,
    people: Array.from(a.people.values()).sort(
      (x, y) => y.pendiente + y.enProceso - (x.pendiente + x.enProceso),
    ),
  }));
}

/** Mediana y percentil 75 (en horas) de una lista de duraciones en ms. */
export function summarize(durationsMs: number[]) {
  const v = durationsMs.filter((d) => d >= 0).sort((a, b) => a - b);
  if (v.length === 0) return { count: 0, medianHours: null, p75Hours: null };
  const at = (q: number) => {
    const i = (v.length - 1) * q;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return v[lo] + (v[hi] - v[lo]) * (i - lo);
  };
  const h = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;
  return { count: v.length, medianHours: h(at(0.5)), p75Hours: h(at(0.75)) };
}
