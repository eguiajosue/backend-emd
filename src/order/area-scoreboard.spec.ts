import { scoreboardFrom } from './order-area-task.service';

// 2026-10-08 12:00 hora de México = 18:00 UTC.
const NOW = new Date('2026-10-08T18:00:00Z');
const at = (day: string, hourUtc = 18) =>
  new Date(`${day}T${String(hourUtc).padStart(2, '0')}:00:00Z`);

describe('marcador del Modo TV', () => {
  it('cuenta hoy, la semana, el mejor día y la racha sin atrasos', () => {
    const r = scoreboardFrom(
      [
        { completedAt: at('2026-10-08'), deliveryDate: at('2026-10-09') },
        { completedAt: at('2026-10-08'), deliveryDate: at('2026-10-07') }, // tarde
        { completedAt: at('2026-10-07'), deliveryDate: at('2026-10-07') },
        { completedAt: at('2026-10-05'), deliveryDate: null },
        { completedAt: at('2026-10-05'), deliveryDate: null },
        { completedAt: at('2026-10-05'), deliveryDate: null },
      ],
      NOW,
    );
    expect(r.today).toEqual({ done: 2, onTime: 1 });
    expect(r.week).toEqual({ done: 6, onTime: 5 });
    expect(r.bestDay).toEqual({ date: '2026-10-05', done: 3 });
    // Hoy hubo un atraso: la racha arranca en cero.
    expect(r.streakDays).toBe(0);
  });

  it('los días sin trabajo no cortan la racha; usa el día de México', () => {
    const r = scoreboardFrom(
      [
        // 02:00 UTC del 8 = 20:00 del 7 en México.
        { completedAt: at('2026-10-08', 2), deliveryDate: at('2026-10-07') },
        { completedAt: at('2026-10-04'), deliveryDate: at('2026-10-10') },
      ],
      NOW,
    );
    expect(r.today.done).toBe(0);
    expect(r.streakDays).toBe(2);
  });

  it('sin nada terminado', () => {
    expect(scoreboardFrom([], NOW)).toEqual({
      today: { done: 0, onTime: 0 },
      week: { done: 0, onTime: 0 },
      bestDay: null,
      streakDays: 0,
    });
  });
});
