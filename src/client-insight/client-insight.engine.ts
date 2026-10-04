/**
 * Motor de aprendizaje por cliente: a partir del historial de pedidos de un
 * cliente arma su perfil de hábitos (qué suele pedir y cuánto, por dónde va,
 * qué materiales lleva, con cuánta anticipación y cada cuánto pide) y, si el
 * patrón es claro, un pedido sugerido para autocompletar el alta.
 *
 * Funciones puras (sin Prisma ni Nest): se testean solas y el servicio las
 * corre de nuevo cada vez que el historial del cliente cambia (ver
 * ClientInsightService). Los pedidos recientes pesan más que los viejos
 * (decaimiento exponencial con vida media `HALF_LIFE_DAYS`): si un cliente
 * cambia de costumbre, el perfil lo sigue en pocos pedidos.
 */

/** Sube cuando cambia el algoritmo: los perfiles guardados con otra versión se recalculan. */
export const ENGINE_VERSION = 1;

/** Cuántos pedidos del cliente se analizan como máximo (los más recientes). */
export const MAX_ORDERS_ANALYZED = 60;

/** Un pedido de hace `HALF_LIFE_DAYS` días pesa la mitad que uno de hoy. */
export const HALF_LIFE_DAYS = 120;

/** Desde qué proporción (ponderada) algo pasa a ser "lo habitual". */
export const HABIT_SHARE = 0.5;

const DAY_MS = 86_400_000;
const MAX_PRODUCTS = 12;
const MAX_MATERIALS = 10;
const MAX_RECENT_DELIVERIES = 10;
const MAX_CADENCE_INTERVALS = 12;
/** Pedidos con menos de esto de diferencia cuentan como la misma "visita" para la cadencia. */
const SAME_VISIT_DAYS = 2;

export interface LearningOrder {
  id: number;
  creationDate: Date;
  deliveryDate: Date | null;
  requiresDesign: boolean;
  productionArea: string | null;
  area: string | null;
  areaTasks: Array<{ area: string }>;
  orderProducts: Array<{ customName: string | null; quantity: number }>;
  materialItems: Array<{
    materialId: number;
    quantity: number;
    description: string;
    supplierId: number | null;
    material?: { name: string; unit?: { name: string } | null } | null;
  }>;
}

export interface ProductHabit {
  /** Nombre tal como se escribió la última vez. */
  name: string;
  /** Clave normalizada (sin mayúsculas, acentos ni espacios de más). */
  key: string;
  /** En cuántos de los pedidos analizados aparece. */
  orders: number;
  /** Proporción ponderada por recencia (0..1) de pedidos que lo incluyen. */
  share: number;
  /** Cantidad típica (mediana ponderada por recencia). */
  typicalQuantity: number;
  lastQuantity: number;
  lastOrderedAt: string;
}

export interface AreaHabit {
  area: string;
  share: number;
}

export interface MaterialHabit {
  materialId: number;
  description: string;
  unitName?: string;
  supplierId?: number;
  orders: number;
  /** Proporción entre los pedidos que YA tienen hoja de materiales. */
  share: number;
  typicalQuantity: number;
}

export interface SuggestedOrder {
  /** "alta": patrón firme; "media": patrón claro pero con pocos pedidos o variaciones. */
  confidence: 'alta' | 'media';
  /** Cuántos pedidos respaldan la sugerencia. */
  basedOn: number;
  requiresDesign: boolean;
  /** Áreas de producción, la principal primero. */
  areas: string[];
  products: Array<{ customName: string; quantity: number }>;
  materials: Array<{
    materialId: number;
    quantity: number;
    description: string;
    supplierId?: number;
    unitName?: string;
  }>;
  /** Días entre el alta y la entrega que suele pedir (null si no hay datos suficientes). */
  leadTimeDays: number | null;
}

export interface ClientProfile {
  version: number;
  ordersAnalyzed: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  products: ProductHabit[];
  route: {
    /** Proporción ponderada de pedidos con diseño. */
    designShare: number;
    requiresDesign: boolean;
    areas: AreaHabit[];
  };
  materials: MaterialHabit[];
  /** Anticipación habitual entre el alta y la entrega. */
  leadTime: { days: number; samples: number } | null;
  /** Últimas fechas de entrega (ISO): el frontend deduce la hora habitual en hora local. */
  recentDeliveries: string[];
  /** Cada cuánto pide. `regular`: los intervalos son parecidos entre sí. */
  cadence: {
    medianDays: number;
    samples: number;
    regular: boolean;
    nextExpectedAt: string;
  } | null;
  suggestion: SuggestedOrder | null;
}

/** "  Lonas  Impresas" -> "lonas impresas"; "Diseño" -> "diseno". */
export function normalizeKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Peso de un pedido según su antigüedad respecto de `now`. */
export function recencyWeight(date: Date, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - date.getTime()) / DAY_MS);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

/** Mediana ponderada (la de menor valor si queda justo en el medio). */
export function weightedMedian(
  samples: Array<{ value: number; weight: number }>,
): number | null {
  const valid = samples.filter((s) => Number.isFinite(s.value) && s.weight > 0);
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, s) => sum + s.weight, 0);
  let acc = 0;
  for (const s of sorted) {
    acc += s.weight;
    if (acc >= total / 2 - 1e-9) return s.value;
  }
  return sorted[sorted.length - 1].value;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Áreas de producción en las que se trabajó un pedido. */
function areasOf(
  order: LearningOrder,
  productionAreas: readonly string[],
): string[] {
  const candidates = [
    order.productionArea,
    ...order.areaTasks.map((t) => t.area),
    order.requiresDesign ? null : order.area,
  ];
  return [
    ...new Set(
      candidates.filter((a): a is string => !!a && productionAreas.includes(a)),
    ),
  ];
}

/**
 * Perfil de hábitos del cliente. `orders` puede venir en cualquier orden;
 * se usan los `MAX_ORDERS_ANALYZED` más recientes.
 */
export function buildClientProfile(
  input: LearningOrder[],
  productionAreas: readonly string[],
  now: Date = new Date(),
): ClientProfile {
  const orders = [...input]
    .sort((a, b) => b.creationDate.getTime() - a.creationDate.getTime())
    .slice(0, MAX_ORDERS_ANALYZED);

  const empty: ClientProfile = {
    version: ENGINE_VERSION,
    ordersAnalyzed: 0,
    firstOrderAt: null,
    lastOrderAt: null,
    products: [],
    route: { designShare: 0, requiresDesign: true, areas: [] },
    materials: [],
    leadTime: null,
    recentDeliveries: [],
    cadence: null,
    suggestion: null,
  };
  if (orders.length === 0) return empty;

  const weights = orders.map((o) => recencyWeight(o.creationDate, now));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  /* ------------------------------- Productos ------------------------------ */
  const products = new Map<
    string,
    {
      name: string;
      orders: number;
      weight: number;
      quantities: Array<{ value: number; weight: number }>;
      lastQuantity: number;
      lastOrderedAt: Date;
    }
  >();
  orders.forEach((order, i) => {
    // Un producto repetido en el mismo pedido cuenta una vez, sumando cantidades.
    const inOrder = new Map<string, { name: string; quantity: number }>();
    for (const op of order.orderProducts) {
      const name = (op.customName ?? '').trim().replace(/\s+/g, ' ');
      const key = normalizeKey(name);
      if (!key || !(op.quantity > 0)) continue;
      const prev = inOrder.get(key);
      inOrder.set(key, {
        name: prev?.name ?? name,
        quantity: (prev?.quantity ?? 0) + op.quantity,
      });
    }
    for (const [key, { name, quantity }] of inOrder) {
      const stat = products.get(key);
      if (!stat) {
        // Los pedidos vienen del más nuevo al más viejo: el primero que se ve es el último.
        products.set(key, {
          name,
          orders: 1,
          weight: weights[i],
          quantities: [{ value: quantity, weight: weights[i] }],
          lastQuantity: quantity,
          lastOrderedAt: order.creationDate,
        });
      } else {
        stat.orders += 1;
        stat.weight += weights[i];
        stat.quantities.push({ value: quantity, weight: weights[i] });
      }
    }
  });
  const productHabits: ProductHabit[] = [...products.entries()]
    .map(([key, s]) => ({
      name: s.name,
      key,
      orders: s.orders,
      share: round2(s.weight / totalWeight),
      typicalQuantity: Math.max(
        1,
        Math.round(weightedMedian(s.quantities) ?? s.lastQuantity),
      ),
      lastQuantity: s.lastQuantity,
      lastOrderedAt: s.lastOrderedAt.toISOString(),
    }))
    .sort(
      (a, b) =>
        b.share - a.share ||
        b.orders - a.orders ||
        b.lastOrderedAt.localeCompare(a.lastOrderedAt),
    )
    .slice(0, MAX_PRODUCTS);

  /* --------------------------------- Ruta --------------------------------- */
  let designWeight = 0;
  const areaWeight = new Map<string, number>();
  const principalWeight = new Map<string, number>();
  orders.forEach((order, i) => {
    if (order.requiresDesign) designWeight += weights[i];
    const areas = areasOf(order, productionAreas);
    for (const area of areas)
      areaWeight.set(area, (areaWeight.get(area) ?? 0) + weights[i]);
    const principal =
      order.productionArea && areas.includes(order.productionArea)
        ? order.productionArea
        : areas[0];
    if (principal)
      principalWeight.set(
        principal,
        (principalWeight.get(principal) ?? 0) + weights[i],
      );
  });
  const designShare = round2(designWeight / totalWeight);
  const areaHabits: AreaHabit[] = [...areaWeight.entries()]
    .map(([area, w]) => ({ area, share: round2(w / totalWeight) }))
    .sort(
      (a, b) =>
        b.share - a.share ||
        (principalWeight.get(b.area) ?? 0) - (principalWeight.get(a.area) ?? 0),
    );

  /* ------------------------------- Materiales ----------------------------- */
  // Sólo cuentan los pedidos que ya tienen hoja: la hoja se carga después
  // del alta (al pasar a producción) y los pedidos nuevos todavía no la tienen.
  const sheetIdx = orders
    .map((o, i) => (o.materialItems.length > 0 ? i : -1))
    .filter((i) => i >= 0);
  const sheetWeight = sheetIdx.reduce((sum, i) => sum + weights[i], 0);
  const materials = new Map<
    number,
    {
      description: string;
      unitName?: string;
      supplierId?: number;
      orders: number;
      weight: number;
      quantities: Array<{ value: number; weight: number }>;
    }
  >();
  for (const i of sheetIdx) {
    const inOrder = new Map<
      number,
      LearningOrder['materialItems'][number] & { total: number }
    >();
    for (const item of orders[i].materialItems) {
      if (!(item.materialId > 0) || !(item.quantity > 0)) continue;
      const prev = inOrder.get(item.materialId);
      inOrder.set(item.materialId, {
        ...(prev ?? item),
        total: (prev?.total ?? 0) + item.quantity,
      });
    }
    for (const [materialId, item] of inOrder) {
      const stat = materials.get(materialId);
      if (!stat) {
        materials.set(materialId, {
          description:
            item.description?.trim() || item.material?.name || 'Material',
          unitName: item.material?.unit?.name ?? undefined,
          supplierId: item.supplierId ?? undefined,
          orders: 1,
          weight: weights[i],
          quantities: [{ value: item.total, weight: weights[i] }],
        });
      } else {
        stat.orders += 1;
        stat.weight += weights[i];
        stat.quantities.push({ value: item.total, weight: weights[i] });
      }
    }
  }
  const materialHabits: MaterialHabit[] = sheetWeight
    ? [...materials.entries()]
        .map(([materialId, s]) => ({
          materialId,
          description: s.description,
          unitName: s.unitName,
          supplierId: s.supplierId,
          orders: s.orders,
          share: round2(s.weight / sheetWeight),
          typicalQuantity: Math.max(
            1,
            Math.round(weightedMedian(s.quantities) ?? 1),
          ),
        }))
        .sort((a, b) => b.share - a.share || b.orders - a.orders)
        .slice(0, MAX_MATERIALS)
    : [];

  /* -------------------------- Anticipación de entrega --------------------- */
  const leadSamples = orders
    .map((o, i) =>
      o.deliveryDate
        ? {
            value: Math.max(
              0,
              (o.deliveryDate.getTime() - o.creationDate.getTime()) / DAY_MS,
            ),
            weight: weights[i],
          }
        : null,
    )
    .filter((s): s is { value: number; weight: number } => s !== null);
  const leadMedian = weightedMedian(leadSamples);
  const leadTime =
    leadMedian === null
      ? null
      : { days: Math.round(leadMedian), samples: leadSamples.length };
  const recentDeliveries = orders
    .filter((o) => o.deliveryDate)
    .slice(0, MAX_RECENT_DELIVERIES)
    .map((o) => o.deliveryDate!.toISOString());

  /* -------------------------------- Cadencia ------------------------------ */
  const visits: Date[] = [];
  for (const o of [...orders].reverse()) {
    const last = visits[visits.length - 1];
    if (
      !last ||
      (o.creationDate.getTime() - last.getTime()) / DAY_MS >= SAME_VISIT_DAYS
    ) {
      visits.push(o.creationDate);
    }
  }
  const intervals = visits
    .slice(1)
    .map((d, i) => (d.getTime() - visits[i].getTime()) / DAY_MS)
    .slice(-MAX_CADENCE_INTERVALS);
  let cadence: ClientProfile['cadence'] = null;
  if (intervals.length >= 2) {
    const medianDays = median(intervals)!;
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const stdev = Math.sqrt(
      intervals.reduce((sum, d) => sum + (d - mean) ** 2, 0) / intervals.length,
    );
    cadence = {
      medianDays: Math.round(medianDays),
      samples: intervals.length,
      regular: mean > 0 && stdev / mean <= 0.6,
      nextExpectedAt: new Date(
        orders[0].creationDate.getTime() + medianDays * DAY_MS,
      ).toISOString(),
    };
  }

  /* --------------------------- Pedido sugerido ---------------------------- */
  const route = {
    designShare,
    requiresDesign: designShare >= HABIT_SHARE,
    areas: areaHabits,
  };
  const suggestion = buildSuggestion(
    orders.length,
    productHabits,
    route,
    principalWeight,
    materialHabits,
    leadTime,
  );

  return {
    version: ENGINE_VERSION,
    ordersAnalyzed: orders.length,
    firstOrderAt: orders[orders.length - 1].creationDate.toISOString(),
    lastOrderAt: orders[0].creationDate.toISOString(),
    products: productHabits,
    route,
    materials: materialHabits,
    leadTime,
    recentDeliveries,
    cadence,
    suggestion,
  };
}

function buildSuggestion(
  ordersAnalyzed: number,
  products: ProductHabit[],
  route: ClientProfile['route'],
  principalWeight: Map<string, number>,
  materials: MaterialHabit[],
  leadTime: ClientProfile['leadTime'],
): SuggestedOrder | null {
  // Con un solo pedido no hay hábito: para eso está "Pedidos anteriores".
  if (ordersAnalyzed < 2) return null;
  const core = products.filter((p) => p.share >= HABIT_SHARE);
  if (core.length === 0) return null;

  let areas = route.areas
    .filter((a) => a.share >= HABIT_SHARE)
    .map((a) => a.area);
  // La principal (la que más veces fue destino) va primero.
  areas.sort(
    (a, b) => (principalWeight.get(b) ?? 0) - (principalWeight.get(a) ?? 0),
  );
  let requiresDesign = route.requiresDesign;
  if (!requiresDesign && areas.length === 0) {
    // Sin diseño hace falta a dónde mandarlo: la más frecuente, o con diseño si no hay ninguna.
    if (route.areas[0]) areas = [route.areas[0].area];
    else requiresDesign = true;
  }

  const avgShare = core.reduce((sum, p) => sum + p.share, 0) / core.length;
  return {
    confidence: ordersAnalyzed >= 3 && avgShare >= 0.75 ? 'alta' : 'media',
    basedOn: ordersAnalyzed,
    requiresDesign,
    areas,
    products: core.map((p) => ({
      customName: p.name,
      quantity: p.typicalQuantity,
    })),
    materials: materials
      .filter((m) => m.share >= HABIT_SHARE)
      .map((m) => ({
        materialId: m.materialId,
        quantity: m.typicalQuantity,
        description: m.description,
        supplierId: m.supplierId,
        unitName: m.unitName,
      })),
    leadTimeDays: leadTime && leadTime.samples >= 2 ? leadTime.days : null,
  };
}
