import type { ErrorEvent, NodeOptions } from '@sentry/nestjs';

/** Headers que nunca salen hacia Sentry (credenciales y sesión). */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
]);

/**
 * Quita del evento todo lo que puede llevar datos personales o credenciales:
 * cuerpo del request (pedidos, archivos en base64, contraseñas del login),
 * cookies, headers de autenticación y la IP/email del usuario. Es la red de
 * seguridad final: `dataCollection` ya pide no recolectar nada de eso.
 */
export function scrubSentryEvent<T extends ErrorEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADERS.has(name.toLowerCase())) {
          delete event.request.headers[name];
        }
      }
    }
  }
  if (event.user) {
    // Sólo el id (si alguien lo setea): nada de IP, email ni username.
    event.user = event.user.id != null ? { id: event.user.id } : undefined;
  }
  return event;
}

/**
 * Variables de entorno que usa Sentry (SENTRY_DSN, SENTRY_ENVIRONMENT,
 * SENTRY_TRACES_SAMPLE_RATE, NODE_ENV), leídas directo de `process.env`:
 * `instrument.ts` corre antes de que exista el ConfigModule.
 */
export type SentryEnv = Record<string, string | undefined>;

/** `tracesSampleRate` de la env: número entre 0 y 1; cualquier otra cosa → 0. */
export function parseTracesSampleRate(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

/**
 * Opciones de `Sentry.init`, o `null` si no hay SENTRY_DSN (Sentry queda
 * apagado: ni siquiera se inicializa el SDK).
 */
export function buildSentryOptions(env: SentryEnv): NodeOptions | null {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return null;
  return {
    dsn,
    environment:
      env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || 'development',
    tracesSampleRate: parseTracesSampleRate(env.SENTRY_TRACES_SAMPLE_RATE),
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { deny: [...SENSITIVE_HEADERS] },
        response: false,
      },
      httpBodies: [],
    },
    beforeSend: (event) => scrubSentryEvent(event),
  };
}
