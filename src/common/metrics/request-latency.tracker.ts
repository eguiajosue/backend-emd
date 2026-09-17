/**
 * Percentiles de latencia HTTP (p50/p90/p95/p99), en memoria, sin
 * infraestructura nueva (sin Prometheus/Datadog/etc.) — sólo un buffer
 * circular de las últimas `WINDOW_SIZE` requests, alimentado por
 * `LoggingInterceptor` en cada response.
 *
 * Limitaciones conocidas (aceptables para el tamaño actual de la app):
 * - Vive en memoria del proceso: se reinicia en cada deploy/cold-start del
 *   plan free de Render. Da una foto de la ventana reciente, no histórico.
 * - Es por instancia. Hoy corre 1 sola instancia (plan free), así que no hay
 *   percentiles que reconciliar entre procesos.
 */

const WINDOW_SIZE = 500;

const durations: number[] = [];
let cursor = 0;

export function recordRequestDuration(ms: number): void {
  if (durations.length < WINDOW_SIZE) {
    durations.push(ms);
  } else {
    durations[cursor] = ms;
    cursor = (cursor + 1) % WINDOW_SIZE;
  }
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1),
  );
  return sortedAsc[idx];
}

export interface RequestLatencySummary {
  sampleSize: number;
  windowSize: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

export function getRequestLatencySummary(): RequestLatencySummary {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    sampleSize: sorted.length,
    windowSize: WINDOW_SIZE,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
  };
}

/** Sólo para tests: vuelve el buffer a su estado inicial. */
export function resetRequestLatencyTracker(): void {
  durations.length = 0;
  cursor = 0;
}
