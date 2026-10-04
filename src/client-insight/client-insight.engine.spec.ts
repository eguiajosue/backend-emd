import {
  buildClientProfile,
  ENGINE_VERSION,
  LearningOrder,
  normalizeKey,
  recencyWeight,
  weightedMedian,
} from './client-insight.engine';

const AREAS = ['taller', 'dtf', 'bordado', 'laser', 'impresiones'] as const;
const NOW = new Date('2026-10-03T18:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

let seq = 0;
function order(
  overrides: Partial<LearningOrder> & { ago?: number } = {},
): LearningOrder {
  const { ago = 0, ...rest } = overrides;
  const creationDate = daysAgo(ago);
  return {
    id: ++seq,
    creationDate,
    deliveryDate: new Date(creationDate.getTime() + 7 * 86_400_000),
    requiresDesign: true,
    productionArea: 'impresiones',
    area: 'diseno',
    areaTasks: [{ area: 'impresiones' }],
    orderProducts: [{ customName: 'Figuras', quantity: 12 }],
    materialItems: [],
    ...rest,
  };
}

describe('helpers', () => {
  it('normaliza nombres: mayúsculas, acentos y espacios', () => {
    expect(normalizeKey('  Lonas   Impresas ')).toBe('lonas impresas');
    expect(normalizeKey('Diseño Bordado')).toBe('diseno bordado');
  });

  it('un pedido de hace una vida media pesa la mitad', () => {
    expect(recencyWeight(NOW, NOW)).toBe(1);
    expect(recencyWeight(daysAgo(120), NOW)).toBeCloseTo(0.5);
    expect(recencyWeight(daysAgo(240), NOW)).toBeCloseTo(0.25);
  });

  it('mediana ponderada', () => {
    expect(weightedMedian([])).toBeNull();
    expect(
      weightedMedian([
        { value: 10, weight: 1 },
        { value: 20, weight: 1 },
        { value: 30, weight: 1 },
      ]),
    ).toBe(20);
    // Lo reciente (peso alto) manda.
    expect(
      weightedMedian([
        { value: 10, weight: 0.2 },
        { value: 10, weight: 0.2 },
        { value: 50, weight: 1 },
      ]),
    ).toBe(50);
  });
});

describe('buildClientProfile', () => {
  it('sin pedidos: perfil vacío y sin sugerencia', () => {
    const profile = buildClientProfile([], AREAS, NOW);
    expect(profile).toMatchObject({
      version: ENGINE_VERSION,
      ordersAnalyzed: 0,
      products: [],
      suggestion: null,
      cadence: null,
    });
  });

  it('con un solo pedido aprende el producto pero todavía no sugiere (no hay hábito)', () => {
    const profile = buildClientProfile([order()], AREAS, NOW);
    expect(profile.products[0]).toMatchObject({
      name: 'Figuras',
      orders: 1,
      share: 1,
      typicalQuantity: 12,
    });
    expect(profile.suggestion).toBeNull();
  });

  it('cliente fiel a "Figuras": sugerencia alta con cantidad, ruta, áreas y anticipación', () => {
    const orders = [
      order({
        ago: 90,
        orderProducts: [{ customName: 'Figuras', quantity: 10 }],
      }),
      order({
        ago: 60,
        orderProducts: [{ customName: 'figuras ', quantity: 12 }],
      }),
      order({
        ago: 30,
        orderProducts: [{ customName: 'FIGURAS', quantity: 12 }],
      }),
      order({
        ago: 1,
        orderProducts: [{ customName: 'Figuras', quantity: 14 }],
      }),
    ];
    const profile = buildClientProfile(orders, AREAS, NOW);
    expect(profile.ordersAnalyzed).toBe(4);
    expect(profile.products).toHaveLength(1);
    expect(profile.products[0]).toMatchObject({
      name: 'Figuras',
      orders: 4,
      share: 1,
      lastQuantity: 14,
    });
    expect(profile.route).toMatchObject({
      requiresDesign: true,
      designShare: 1,
    });
    expect(profile.route.areas).toEqual([{ area: 'impresiones', share: 1 }]);
    expect(profile.leadTime).toEqual({ days: 7, samples: 4 });
    expect(profile.suggestion).toEqual({
      confidence: 'alta',
      basedOn: 4,
      requiresDesign: true,
      areas: ['impresiones'],
      products: [{ customName: 'Figuras', quantity: 12 }],
      materials: [],
      leadTimeDays: 7,
    });
  });

  it('lo reciente pesa más: un cambio de costumbre se refleja en pocos pedidos', () => {
    const orders = [
      order({
        ago: 400,
        orderProducts: [{ customName: 'Playeras', quantity: 50 }],
      }),
      order({
        ago: 380,
        orderProducts: [{ customName: 'Playeras', quantity: 50 }],
      }),
      order({
        ago: 360,
        orderProducts: [{ customName: 'Playeras', quantity: 50 }],
      }),
      order({
        ago: 20,
        orderProducts: [{ customName: 'Figuras', quantity: 12 }],
      }),
      order({
        ago: 5,
        orderProducts: [{ customName: 'Figuras', quantity: 12 }],
      }),
    ];
    const profile = buildClientProfile(orders, AREAS, NOW);
    expect(profile.products.map((p) => p.name)).toEqual([
      'Figuras',
      'Playeras',
    ]);
    expect(profile.products[0].share).toBeGreaterThan(0.5);
    expect(profile.products[1].share).toBeLessThan(0.5);
    expect(profile.suggestion?.products).toEqual([
      { customName: 'Figuras', quantity: 12 },
    ]);
  });

  it('si pide cosas distintas cada vez no inventa un "habitual"', () => {
    const orders = [
      order({ ago: 30, orderProducts: [{ customName: 'Lona', quantity: 1 }] }),
      order({
        ago: 20,
        orderProducts: [{ customName: 'Gorras', quantity: 20 }],
      }),
      order({
        ago: 10,
        orderProducts: [{ customName: 'Playeras', quantity: 30 }],
      }),
    ];
    const profile = buildClientProfile(orders, AREAS, NOW);
    expect(profile.products).toHaveLength(3);
    expect(profile.suggestion).toBeNull();
  });

  it('sin diseño: aprende el área principal y descarta Diseño como destino', () => {
    const direct = (ago: number) =>
      order({
        ago,
        requiresDesign: false,
        area: 'bordado',
        productionArea: null,
        areaTasks: [{ area: 'bordado' }, { area: 'dtf' }],
        orderProducts: [{ customName: 'Playera bordada', quantity: 40 }],
      });
    const profile = buildClientProfile(
      [direct(40), direct(20), direct(2)],
      AREAS,
      NOW,
    );
    expect(profile.route.requiresDesign).toBe(false);
    expect(profile.suggestion).toMatchObject({
      requiresDesign: false,
      areas: ['bordado', 'dtf'],
      products: [{ customName: 'Playera bordada', quantity: 40 }],
    });
  });

  it('sin diseño y sin áreas conocidas, la sugerencia va con diseño (necesita a dónde ir)', () => {
    const noArea = (ago: number) =>
      order({
        ago,
        requiresDesign: false,
        area: null,
        productionArea: null,
        areaTasks: [],
      });
    const profile = buildClientProfile([noArea(10), noArea(5)], AREAS, NOW);
    expect(profile.suggestion).toMatchObject({
      requiresDesign: true,
      areas: [],
    });
  });

  it('materiales: sólo cuentan los pedidos que ya tienen hoja', () => {
    const vinil = {
      materialId: 5,
      quantity: 6,
      description: 'Vinil impreso sobre coroplast',
      supplierId: 2,
      material: { name: 'Coroplast', unit: { name: 'Hoja' } },
    };
    const orders = [
      order({ ago: 60, materialItems: [vinil] }),
      order({
        ago: 30,
        materialItems: [
          { ...vinil, quantity: 4 },
          { ...vinil, quantity: 2 },
        ],
      }),
      // Recién creado: todavía sin hoja; no debe bajar la proporción.
      order({ ago: 1, materialItems: [] }),
    ];
    const profile = buildClientProfile(orders, AREAS, NOW);
    expect(profile.materials).toEqual([
      {
        materialId: 5,
        description: 'Vinil impreso sobre coroplast',
        unitName: 'Hoja',
        supplierId: 2,
        orders: 2,
        share: 1,
        typicalQuantity: 6,
      },
    ]);
    expect(profile.suggestion?.materials).toEqual([
      {
        materialId: 5,
        quantity: 6,
        description: 'Vinil impreso sobre coroplast',
        supplierId: 2,
        unitName: 'Hoja',
      },
    ]);
  });

  it('cadencia: cada ~30 días, con los pedidos del mismo día contados como una visita', () => {
    const orders = [
      order({ ago: 90 }),
      order({ ago: 60 }),
      order({ ago: 59.9 }), // misma visita
      order({ ago: 31 }),
      order({ ago: 1 }),
    ];
    const profile = buildClientProfile(orders, AREAS, NOW);
    expect(profile.cadence).toMatchObject({
      medianDays: 30,
      samples: 3,
      regular: true,
    });
    const next = new Date(profile.cadence!.nextExpectedAt).getTime();
    expect(Math.round((next - daysAgo(1).getTime()) / 86_400_000)).toBe(30);
  });

  it('cadencia: hacen falta al menos 3 visitas', () => {
    const profile = buildClientProfile(
      [order({ ago: 40 }), order({ ago: 10 })],
      AREAS,
      NOW,
    );
    expect(profile.cadence).toBeNull();
  });

  it('anticipación: sin fechas suficientes no se sugiere', () => {
    const orders = [order({ ago: 20 }), order({ ago: 10, deliveryDate: null })];
    const profile = buildClientProfile(orders, AREAS, NOW);
    expect(profile.leadTime).toEqual({ days: 7, samples: 1 });
    expect(profile.suggestion?.leadTimeDays).toBeNull();
  });

  it('analiza sólo los 60 pedidos más recientes', () => {
    const many = Array.from({ length: 70 }, (_, i) => order({ ago: i }));
    expect(buildClientProfile(many, AREAS, NOW).ordersAnalyzed).toBe(60);
  });
});
