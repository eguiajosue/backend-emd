import {
  getRequestLatencySummary,
  recordRequestDuration,
  resetRequestLatencyTracker,
} from './request-latency.tracker';

describe('request-latency.tracker', () => {
  beforeEach(() => {
    resetRequestLatencyTracker();
  });

  it('sin muestras: todo en 0', () => {
    expect(getRequestLatencySummary()).toEqual({
      sampleSize: 0,
      windowSize: 500,
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      max: 0,
    });
  });

  it('calcula percentiles sobre un set conocido (1..100)', () => {
    for (let i = 1; i <= 100; i++) {
      recordRequestDuration(i);
    }
    const summary = getRequestLatencySummary();
    expect(summary.sampleSize).toBe(100);
    expect(summary.p50).toBe(50);
    expect(summary.p90).toBe(90);
    expect(summary.p95).toBe(95);
    expect(summary.p99).toBe(99);
    expect(summary.max).toBe(100);
  });

  it('un pico aislado mueve el p99 pero no el p50 (el motivo de priorizar p95 sobre el promedio)', () => {
    for (let i = 0; i < 98; i++) {
      recordRequestDuration(100);
    }
    recordRequestDuration(5000);

    const summary = getRequestLatencySummary();
    expect(summary.sampleSize).toBe(99);
    expect(summary.p50).toBe(100);
    expect(summary.p99).toBe(5000);
  });

  it('buffer circular: sólo retiene las últimas `windowSize` muestras', () => {
    for (let i = 1; i <= 500; i++) {
      recordRequestDuration(1);
    }
    recordRequestDuration(9999); // pisa la muestra más vieja

    const summary = getRequestLatencySummary();
    expect(summary.sampleSize).toBe(500);
    expect(summary.max).toBe(9999);
  });
});
