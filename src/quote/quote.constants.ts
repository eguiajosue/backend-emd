/**
 * Etapas y subestados de una cotización (ver
 * frontend-emd/docs/plans/cotizaciones.md). Cada subestado pertenece a UNA
 * sola etapa, así que el subestado alcanza para saber la etapa.
 */
export const QUOTE_STAGES = ['por_enviar', 'enviada'] as const;
export type QuoteStage = (typeof QUOTE_STAGES)[number];

export const QUOTE_STATUSES_BY_STAGE = {
  por_enviar: ['lista', 'pendiente_medidas', 'info', 'esperando_montaje'],
  enviada: ['esperando_respuesta', 'aceptada', 'no_aceptada', 'comentarios'],
} as const satisfies Record<QuoteStage, readonly string[]>;

export type QuoteStatus = (typeof QUOTE_STATUSES_BY_STAGE)[QuoteStage][number];

export const QUOTE_STATUSES: readonly QuoteStatus[] = [
  ...QUOTE_STATUSES_BY_STAGE.por_enviar,
  ...QUOTE_STATUSES_BY_STAGE.enviada,
];

/** Subestado que toma una cotización al entrar a cada etapa sin indicar uno. */
export const DEFAULT_QUOTE_STATUS: Record<QuoteStage, QuoteStatus> = {
  por_enviar: 'lista',
  enviada: 'esperando_respuesta',
};

/** Único subestado desde el que se puede ligar el pedido creado. */
export const QUOTE_ACCEPTED_STATUS: QuoteStatus = 'aceptada';

export const MAX_QUOTE_CLIENT_NAME_LENGTH = 120;
export const MAX_QUOTE_DESCRIPTION_LENGTH = 1000;
export const MAX_QUOTE_COMMENT_LENGTH = 1000;
export const MAX_QUOTE_SEARCH_LENGTH = 100;
/** Tope de `POST /quotes/bulk` ("pegar lista" de WhatsApp). */
export const MAX_QUOTE_BULK_ITEMS = 100;

export const QUOTE_STAGE_MESSAGE = `La etapa debe ser una de: ${QUOTE_STAGES.join(', ')}`;
export const QUOTE_STATUS_MESSAGE = `El subestado debe ser uno de: ${QUOTE_STATUSES.join(', ')}`;
export const QUOTE_CLIENT_NAME_MESSAGE = `El nombre del cliente es obligatorio (máx. ${MAX_QUOTE_CLIENT_NAME_LENGTH} caracteres)`;
export const QUOTE_DESCRIPTION_MESSAGE = `La descripción es obligatoria (máx. ${MAX_QUOTE_DESCRIPTION_LENGTH} caracteres)`;
export const QUOTE_COMMENT_MESSAGE = `El comentario no puede superar ${MAX_QUOTE_COMMENT_LENGTH} caracteres`;
export const QUOTE_PRIORITY_DATE_MESSAGE =
  'La fecha de prioridad debe tener el formato AAAA-MM-DD';
export const QUOTE_NUL_MESSAGE = 'El texto contiene caracteres no permitidos';

export function isQuoteStage(value: unknown): value is QuoteStage {
  return (
    typeof value === 'string' &&
    (QUOTE_STAGES as readonly string[]).includes(value)
  );
}

export function isQuoteStatus(value: unknown): value is QuoteStatus {
  return (
    typeof value === 'string' &&
    (QUOTE_STATUSES as readonly string[]).includes(value)
  );
}

/** Etapa a la que pertenece un subestado. */
export function stageOfStatus(status: QuoteStatus): QuoteStage {
  return (QUOTE_STATUSES_BY_STAGE.por_enviar as readonly string[]).includes(
    status,
  )
    ? 'por_enviar'
    : 'enviada';
}

/** `YYYY-MM-DD` que además es una fecha real (no 2026-02-30). */
export function isIsoDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
