import { Prisma } from '@prisma/client';

/** Palabras de la búsqueda que se tienen en cuenta (el resto se ignora). */
export const MAX_QUOTE_SEARCH_TERMS = 6;

/** Letra sin acento → con acento (en español, casi siempre una por palabra). */
const ACCENTED: Record<string, string[]> = {
  a: ['á'],
  e: ['é'],
  i: ['í'],
  o: ['ó'],
  u: ['ú', 'ü'],
  n: ['ñ'],
};

/** Quita tildes y diéresis (`José Peña` → `Jose Pena`). */
export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Variantes de una palabra para buscar sin distinguir acentos con un simple
 * `ILIKE` (Prisma `mode: 'insensitive'`), sin extensiones de Postgres: la
 * palabra tal cual, sin acentos, y sin acentos con UNA letra acentuada en
 * cada posición posible. Así `jose` encuentra `José` y `pena` encuentra
 * `Peña`; dos acentos en la misma palabra no (best effort).
 */
export function accentVariants(term: string): string[] {
  const plain = stripAccents(term).toLowerCase();
  const variants = new Set<string>([term, plain]);
  for (let i = 0; i < plain.length; i++) {
    for (const accented of ACCENTED[plain[i]] ?? []) {
      variants.add(plain.slice(0, i) + accented + plain.slice(i + 1));
    }
  }
  return [...variants];
}

/**
 * `where` de la búsqueda libre de `GET /quotes?q=`: cada palabra (hasta
 * MAX_QUOTE_SEARCH_TERMS) tiene que aparecer en el cliente o en la
 * descripción, sin distinguir mayúsculas ni (best effort) acentos. `null`
 * si no hay nada que buscar.
 */
export function quoteSearchWhere(
  q: string | undefined,
): Prisma.QuoteWhereInput | null {
  const terms = (q ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_QUOTE_SEARCH_TERMS);
  if (terms.length === 0) return null;
  return {
    AND: terms.map((term) => ({
      OR: accentVariants(term).flatMap((variant) => [
        { clientName: { contains: variant, mode: 'insensitive' as const } },
        { description: { contains: variant, mode: 'insensitive' as const } },
      ]),
    })),
  };
}
