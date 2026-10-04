import {
  areaHealth,
  attentionFor,
  AttentionInput,
  compareAttention,
  deadlineTone,
} from './dashboard.rules';

const NOW = new Date('2026-10-03T18:00:00Z');
const H = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * H);

const input = (overrides: Partial<AttentionInput> = {}): AttentionInput => ({
  phase: 'production',
  deliveryDate: at(24 * 5),
  creationDate: at(-24),
  started: true,
  lastSentAt: null,
  lastFeedbackAt: null,
  readySince: null,
  ...overrides,
});

describe('deadlineTone (mismo criterio que el frontend)', () => {
  it('vencido, en riesgo (<48 h), a tiempo y sin fecha', () => {
    expect(deadlineTone(at(-1), NOW)).toBe('overdue');
    expect(deadlineTone(at(47), NOW)).toBe('at_risk');
    expect(deadlineTone(at(49), NOW)).toBe('on_time');
    expect(deadlineTone(null, NOW)).toBe('no_date');
  });
});

describe('areaHealth', () => {
  it('rojo con vencidos; amarillo con riesgo o algo esperando más de un día; verde si no', () => {
    expect(
      areaHealth({ overdue: 1, atRisk: 0, oldestWaitingSince: null }, NOW),
    ).toBe('critical');
    expect(
      areaHealth({ overdue: 0, atRisk: 2, oldestWaitingSince: null }, NOW),
    ).toBe('warning');
    expect(
      areaHealth({ overdue: 0, atRisk: 0, oldestWaitingSince: at(-30) }, NOW),
    ).toBe('warning');
    expect(
      areaHealth({ overdue: 0, atRisk: 0, oldestWaitingSince: at(-2) }, NOW),
    ).toBe('ok');
  });
});

describe('attentionFor', () => {
  it('un pedido sano no requiere atención', () => {
    expect(attentionFor(input(), NOW)).toBeNull();
  });

  it('vencido manda sobre todo lo demás', () => {
    expect(
      attentionFor(input({ deliveryDate: at(-3), started: false }), NOW),
    ).toEqual({
      reason: 'overdue',
      since: at(-3),
    });
  });

  it('por vencer y sin empezar', () => {
    expect(
      attentionFor(input({ deliveryDate: at(20), started: false }), NOW)
        ?.reason,
    ).toBe('at_risk_not_started');
    expect(
      attentionFor(input({ deliveryDate: at(20), started: true }), NOW),
    ).toBeNull();
  });

  it('listo sin entregar: si pasó la fecha o lleva más de un día listo', () => {
    expect(
      attentionFor(input({ phase: 'ready', readySince: at(-2) }), NOW),
    ).toBeNull();
    expect(
      attentionFor(input({ phase: 'ready', readySince: at(-30) }), NOW)?.reason,
    ).toBe('ready_not_delivered');
    expect(
      attentionFor(
        input({ phase: 'ready', readySince: at(-2), deliveryDate: at(-1) }),
        NOW,
      )?.reason,
    ).toBe('ready_not_delivered');
  });

  it('esperando autorización más de 48 h: hay que llamar al cliente', () => {
    expect(
      attentionFor(
        input({ phase: 'waiting_client', lastSentAt: at(-10) }),
        NOW,
      ),
    ).toBeNull();
    expect(
      attentionFor(
        input({ phase: 'waiting_client', lastSentAt: at(-60) }),
        NOW,
      ),
    ).toEqual({
      reason: 'waiting_client',
      since: at(-60),
    });
    // Esperando al cliente no es "sin empezar" aunque venza pronto.
    expect(
      attentionFor(
        input({
          phase: 'waiting_client',
          lastSentAt: at(-5),
          deliveryDate: at(10),
          started: false,
        }),
        NOW,
      ),
    ).toBeNull();
  });

  it('cambios pedidos hace más de un día y diseño nuevo sin abrir', () => {
    expect(
      attentionFor(input({ phase: 'changes', lastFeedbackAt: at(-30) }), NOW)
        ?.reason,
    ).toBe('changes_requested');
    expect(
      attentionFor(
        input({ phase: 'design_new', started: false, creationDate: at(-30) }),
        NOW,
      )?.reason,
    ).toBe('design_not_started');
  });

  it('sin fecha de entrega', () => {
    expect(attentionFor(input({ deliveryDate: null }), NOW)).toEqual({
      reason: 'no_date',
      since: at(-24),
    });
  });

  it('ordena por gravedad y después por antigüedad', () => {
    const list = [
      { reason: 'no_date' as const, since: at(-100) },
      { reason: 'overdue' as const, since: at(-1) },
      { reason: 'overdue' as const, since: at(-5) },
      { reason: 'waiting_client' as const, since: at(-70) },
    ].sort(compareAttention);
    expect(
      list.map((i) => `${i.reason}@${(i.since.getTime() - NOW.getTime()) / H}`),
    ).toEqual([
      'overdue@-5',
      'overdue@-1',
      'waiting_client@-70',
      'no_date@-100',
    ]);
  });
});
