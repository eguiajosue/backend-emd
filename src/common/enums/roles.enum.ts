export enum Role {
  ADMIN = 'admin',
  TALLER = 'taller',
  RECEPCION = 'recepcion',
  SUPERUSER = 'superuser',
  DTF = 'dtf',
  BORDADO = 'bordado',
  DISENO = 'diseno',
  LASER = 'laser',
  IMPRESIONES = 'impresiones',
  /**
   * Cuenta compartida de una sucursal (ej. "Punto Madero", ver Branch). Sólo
   * levanta pedidos, usa Mockups y ve SUS pedidos (filtrados por sucursal).
   */
  SUCURSAL = 'sucursal',
}
