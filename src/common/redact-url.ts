/**
 * El enlace privado del portal del cliente es la llave de acceso (token de 32
 * bytes en la ruta: `/portal/<token>/...`). Quien lo tenga ve el pedido, así
 * que no debe quedar en logs ni en reportes de error. Se reemplaza el
 * segmento del token y se conserva el resto de la ruta para poder depurar.
 */
const PORTAL_TOKEN_SEGMENT = /(\/portal\/)[^/?#]+/i;

export function redactSecretsInUrl(url: string): string {
  return url.replace(PORTAL_TOKEN_SEGMENT, '$1[token]');
}
