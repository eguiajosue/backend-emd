/**
 * Código legible de un pedido: `EMD-P0042`. Es el que ve la gente (avisos,
 * chat, PDF) en vez del id interno. Se deriva del id —único, nunca cambia y
 * no necesita columna propia ni migración—; el relleno a 4 dígitos crece solo
 * pasado el 9999. Misma regla que `formatOrderCode` en el front
 * (`@emd/business/orderCode`): mantener ambas en sync.
 */
export function formatOrderCode(id: number): string {
  return `EMD-P${String(id).padStart(4, '0')}`;
}

/**
 * Id del pedido a partir de lo que alguien escribe en un buscador: acepta el
 * código completo ("EMD-P0042", "emd p42"), "P42", "#42" o "42". `null` si el
 * texto no es un código de pedido. Mismo criterio que `parseOrderCode` del front.
 */
export function parseOrderCode(text: string): number | null {
  const match = text.trim().match(/^(?:emd[\s_-]*)?(?:p[\s_-]*)?#?0*(\d+)$/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}
