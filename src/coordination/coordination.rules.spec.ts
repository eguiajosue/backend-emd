import {
  daysLate,
  deadlineState,
  loadByArea,
  summarize,
  type LoadTask,
} from './coordination.rules';

// 2026-10-08 12:00 en México.
const NOW = new Date('2026-10-08T18:00:00Z');
const day = (d: string) => new Date(`${d}T18:00:00Z`);

describe('Coordinación: plazos', () => {
  it('atrasado sólo cuando ya pasó el día de entrega (hora de México)', () => {
    expect(deadlineState(day('2026-10-07'), NOW)).toBe('atrasado');
    expect(deadlineState(day('2026-10-08'), NOW)).toBe('pronto');
    expect(deadlineState(day('2026-10-09'), NOW)).toBe('pronto');
    expect(deadlineState(day('2026-10-10'), NOW)).toBeNull();
    expect(deadlineState(null, NOW)).toBeNull();
    expect(daysLate(day('2026-10-05'), NOW)).toBe(3);
    expect(daysLate(day('2026-10-09'), NOW)).toBe(0);
  });
});

describe('Coordinación: carga por área y persona', () => {
  const t = (o: Partial<LoadTask>): LoadTask => ({
    area: 'bordado',
    status: 'pendiente',
    assignedUserId: null,
    assigneeName: null,
    sharedAccount: false,
    deliveryDate: null,
    ...o,
  });

  it('cuenta pendientes, en proceso, atrasadas, pronto y sin persona', () => {
    const [bordado, dtf] = loadByArea(
      [
        t({ deliveryDate: day('2026-10-01') }),
        t({
          status: 'en_proceso',
          assignedUserId: 7,
          assigneeName: 'Ana',
          deliveryDate: day('2026-10-08'),
        }),
        t({ assignedUserId: 7, assigneeName: 'Ana' }),
        t({
          assignedUserId: 9,
          assigneeName: 'Área: Bordado',
          sharedAccount: true,
        }),
        t({ status: 'terminado', assignedUserId: 7 }),
        t({ area: 'laser' }), // fuera de las áreas pedidas
      ],
      NOW,
      ['bordado', 'dtf'],
    );
    expect(bordado).toMatchObject({
      area: 'bordado',
      pendiente: 3,
      enProceso: 1,
      atrasadas: 1,
      pronto: 1,
      sinPersona: 2,
    });
    expect(bordado.people).toEqual([
      {
        userId: 7,
        name: 'Ana',
        pendiente: 1,
        enProceso: 1,
        atrasadas: 0,
        pronto: 1,
      },
    ]);
    expect(dtf).toMatchObject({ pendiente: 0, people: [] });
  });
});

describe('Coordinación: tiempos', () => {
  it('mediana y p75 en horas', () => {
    const h = 3_600_000;
    expect(summarize([1 * h, 2 * h, 3 * h, 10 * h])).toEqual({
      count: 4,
      medianHours: 2.5,
      p75Hours: 4.8,
    });
    expect(summarize([])).toEqual({
      count: 0,
      medianHours: null,
      p75Hours: null,
    });
  });
});
