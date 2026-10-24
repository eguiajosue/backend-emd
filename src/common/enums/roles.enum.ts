/**
 * Roles de usuario: QUÉ puede hacer cada quien. Las áreas de trabajo (Taller,
 * Bordado, Diseño...) NO son roles: son filas de `Area` y en `@Auth(...)` se
 * piden con `AreaAccess` (ver area-access.enum.ts).
 */
export enum Role {
  ADMIN = 'admin',
  RECEPCION = 'recepcion',
  SUPERUSER = 'superuser',
  /**
   * Cuenta compartida de una sucursal (ej. "Punto Madero", ver Branch). Sólo
   * levanta pedidos, usa Mockups y ve SUS pedidos (filtrados por sucursal).
   */
  SUCURSAL = 'sucursal',
}
