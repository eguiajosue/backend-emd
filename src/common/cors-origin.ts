/**
 * Resolución de origins permitidos para CORS (HTTP y Socket.io).
 *
 * Vercel asigna, además del dominio estable del proyecto, una URL única con
 * hash aleatorio en cada deploy (ej. frontend-emd-dx27-4dct7dcr7-...vercel.app).
 * Exigir que FRONTEND_URL se actualice a mano cada vez rompía CORS constantemente.
 * En su lugar, aceptamos cualquier origin que coincida EXACTO con FRONTEND_URL
 * (lista separada por comas) O que matchee el patrón de subdominios *.vercel.app
 * del propio proyecto (frontend-emd-*), sin abrir CORS a orígenes arbitrarios.
 */

/**
 * Cualquier variante *.vercel.app del proyecto: preview, producción, o con
 * hash de deploy.
 *
 * Hay DOS formas y las dos hacen falta:
 *
 * 1. El dominio del proyecto — `frontend-emd-five.vercel.app`.
 * 2. La URL única de cada deploy, que Vercel arma como
 *    `<proyecto-recortado>-<hash>-<scope>.vercel.app`. Recorta el nombre del
 *    proyecto, así que `frontend-emd` sale como `frontend`:
 *    `frontend-hbp5awpny-eguiajosues-projects.vercel.app`. Esa URL NO empieza
 *    con `frontend-emd` y por eso quedaba fuera — el navegador recibía el
 *    preflight rechazado y la app mostraba "no se puede conectar al servidor".
 *
 * El scope (la cuenta de Vercel) es lo que mantiene esto cerrado: sin él,
 * cualquier sitio alojado en vercel.app podría llamar a la API con
 * credenciales.
 */
const VERCEL_PROJECT_ORIGIN_REGEX =
  /^https:\/\/frontend-emd(-[a-z0-9]+)*\.vercel\.app$/;

const VERCEL_SCOPE_ORIGIN_REGEX =
  /^https:\/\/[a-z0-9]+(-[a-z0-9]+)*-eguiajosues-projects\.vercel\.app$/;

export function parseAllowedOrigins(frontendUrl: string): string[] {
  return frontendUrl
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
): boolean {
  // Requests sin header Origin (curl, apps nativas, health checks) no aplican CORS.
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  return (
    VERCEL_PROJECT_ORIGIN_REGEX.test(origin) ||
    VERCEL_SCOPE_ORIGIN_REGEX.test(origin)
  );
}

/** Callback de origin compatible con `cors` (usado por Nest) y con Socket.io. */
export function buildCorsOriginCallback(allowedOrigins: string[]) {
  return (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    callback(null, isOriginAllowed(origin, allowedOrigins));
  };
}
