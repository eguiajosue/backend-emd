import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Servicios de Web Push de los navegadores. El `endpoint` de una suscripción
 * lo manda el cliente y el backend le hace un POST en cada aviso: si se
 * aceptara cualquier URL, quien pueda suscribirse (una sesión, o el portal
 * público del cliente con su enlace) haría que el servidor llamara a un host
 * de su elección, incluida la red interna (SSRF). Sólo se aceptan estos.
 *
 * - Chrome, Edge (Android), Opera, Brave, Samsung: FCM.
 * - Firefox: Mozilla autopush.
 * - Edge (escritorio): WNS.
 * - Safari: APNs web push.
 */
const PUSH_SERVICE_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com'];
const PUSH_SERVICE_HOST_SUFFIXES = [
  '.push.services.mozilla.com',
  '.notify.windows.com',
  '.push.apple.com',
];

export function isAllowedPushEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  // Los servicios de push usan el puerto por defecto.
  if (url.port !== '') return false;
  const host = url.hostname.toLowerCase();
  return (
    PUSH_SERVICE_HOSTS.includes(host) ||
    PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

/** `endpoint` de una suscripción Web Push: https y de un servicio conocido. */
export function IsPushServiceEndpoint(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isPushServiceEndpoint',
      target: object.constructor,
      propertyName,
      options: { message: 'Suscripción inválida', ...options },
      validator: { validate: (value: unknown) => isAllowedPushEndpoint(value) },
    });
  };
}
