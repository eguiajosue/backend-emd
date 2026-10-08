import { z } from 'zod';

/**
 * En `.env.example` las opcionales vienen como `VAR=""`: un string vacío
 * cuenta como "no definida" (si no, una URL o un enum vacío no validaría).
 */
const optionalString = () =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().optional(),
  );

/**
 * Esquema de variables de entorno.
 *
 * Se valida al arranque (ConfigModule.forRoot({ validate })): si falta algo
 * obligatorio la app falla rápido con un mensaje claro en vez de arrancar rota
 * (por ejemplo firmando JWTs con `undefined`).
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  // Obligatorias
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),

  // Opcionales con default
  JWT_REFRESH_SECRET: z.string().min(32).optional(),
  JWT_ACCESS_EXPIRES_IN: z.string().default('1d'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  PORT: z.coerce.number().int().positive().optional(),
  BACKEND_PORT: z.coerce.number().int().positive().default(3001),

  FRONTEND_URL: z.string().default('http://localhost:3000'),

  // Escalado horizontal de Socket.io (opcional: sin esto se usa memoria)
  REDIS_URL: z.string().optional(),

  // Protección basic-auth opcional de /api/docs
  SWAGGER_USER: z.string().optional(),
  SWAGGER_PASSWORD: z.string().optional(),

  THROTTLE_TTL: z.coerce.number().int().positive().default(60000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(60),

  // Envío de reportes de bugs por email (Resend). Opcional: si no está
  // configurada, el endpoint de reportes responde 503 en vez de fallar.
  RESEND_API_KEY: z.string().optional(),
  // Destinatario y remitente de los reportes de bug. Ver .env.example: el
  // remitente por defecto (onboarding@resend.dev) sólo entrega al email dueño
  // de la cuenta de Resend.
  BUG_REPORT_RECIPIENT: z.string().optional(),
  BUG_REPORT_FROM: z.string().optional(),
  // Aviso "tu pedido está listo" por correo al cliente (portal, WORKFLOW.md
  // §8). Sin remitente verificado en Resend no se manda correo (sí el push).
  CLIENT_EMAIL_FROM: z.string().optional(),
  // Base de los enlaces del portal en avisos; si falta, el 1er FRONTEND_URL.
  CLIENT_PORTAL_URL: z.string().optional(),

  // Almacenamiento de archivos (ver src/storage y docs/storage-r2.md).
  // `db` (default) = base64 en Postgres como siempre; `s3` = Cloudflare R2 o
  // cualquier S3 compatible, con las S3_* obligatorias.
  STORAGE_DRIVER: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['db', 's3']).default('db'),
  ),
  S3_ENDPOINT: optionalString(),
  S3_REGION: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().default('auto'),
  ),
  S3_BUCKET: optionalString(),
  S3_ACCESS_KEY_ID: optionalString(),
  S3_SECRET_ACCESS_KEY: optionalString(),

  // Monitoreo de errores con Sentry (ver src/instrument.ts y
  // docs/monitoring.md). Sin SENTRY_DSN queda apagado.
  SENTRY_DSN: optionalString(),
  SENTRY_ENVIRONMENT: optionalString(),
  SENTRY_TRACES_SAMPLE_RATE: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().min(0).max(1).default(0),
  ),
});

/** Variables S3_* sin las que el driver `s3` no puede funcionar. */
export const REQUIRED_S3_VARS = [
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema
    .superRefine((env, ctx) => {
      if (env.STORAGE_DRIVER !== 's3') return;
      for (const name of REQUIRED_S3_VARS) {
        if (!env[name]) {
          ctx.addIssue({
            code: 'custom',
            path: [name],
            message: `${name} es obligatoria con STORAGE_DRIVER=s3`,
          });
        }
      }
    })
    .safeParse(config);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Error de configuración: variables de entorno inválidas o faltantes:\n${details}`,
    );
  }

  return parsed.data;
}
