import { z } from 'zod';

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
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);

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
