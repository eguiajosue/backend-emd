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
