import { Role } from '../enums/roles.enum';

/**
 * Roles que pueden ver pedidos (y, por lo tanto, todo lo que la pantalla de
 * Pedidos necesita para renderizarse: catálogos, productos del pedido,
 * historial, etc.).
 *
 * Cualquier endpoint de SOLO LECTURA que la pantalla de Pedidos consulte al
 * cargar debe aceptar exactamente este conjunto; si no, el usuario operativo
 * recibe un 403 ("Forbidden resource") apenas entra a la sección.
 */
export const ORDER_VIEWING_ROLES: Role[] = [
  Role.RECEPCION,
  Role.ADMIN,
  Role.SUPERUSER,
  Role.TALLER,
  Role.DTF,
  Role.BORDADO,
  Role.DISENO,
  Role.LASER,
  Role.IMPRESIONES,
];

/**
 * Lectura del detalle de UN pedido para la cuenta de sucursal (ej. "Punto
 * Madero"): sus pedidos, su avance y la hoja de autorización, sólo lectura.
 * El service limita la sucursal a SUS pedidos (`assertOrderAccess`).
 */
export const ORDER_VIEWING_ROLES_WITH_BRANCH: Role[] = [
  ...ORDER_VIEWING_ROLES,
  Role.SUCURSAL,
];
