import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { UserController } from 'src/user/user.controller';
import { ClientController } from 'src/client/client.controller';
import { OrderController } from 'src/order/order.controller';

/**
 * Regresión del bug reportado: un usuario con roles operativos (p. ej.
 * diseno+bordado+dtf) recibía "Forbidden Resource" al abrir la sección de
 * Pedidos porque GET /users y GET /clients (llamados por la pantalla para
 * poblar los filtros y nombres) no incluían los roles operativos en su
 * @Auth(...), aunque GET /orders sí los incluía.
 *
 * Este test verifica, vía metadata de Nest (Reflector + ROLES_KEY), que
 * todos los endpoints que la pantalla de Pedidos consulta al cargar
 * (GET /orders, GET /users, GET /clients) aceptan exactamente el mismo
 * conjunto de roles: todos los que pueden ver pedidos.
 */
describe('Endpoints consultados por la pantalla de Pedidos: paridad de roles', () => {
  const reflector = new Reflector();

  const ALL_ORDER_VIEWING_ROLES = [
    Role.RECEPCION,
    Role.ADMIN,
    Role.SUPERUSER,
    Role.TALLER,
    Role.DTF,
    Role.BORDADO,
    Role.DISENO,
    Role.LASER,
    Role.IMPRESIONES,
  ].sort();

  const rolesFor = (target: any, methodName: string): string[] => {
    const roles: Role[] =
      reflector.get(ROLES_KEY, target.prototype[methodName]) ?? [];
    return [...roles].sort();
  };

  it('GET /orders acepta todos los roles que pueden ver pedidos', () => {
    expect(rolesFor(OrderController, 'findAll')).toEqual(
      ALL_ORDER_VIEWING_ROLES,
    );
  });

  it('GET /orders/:id acepta todos los roles que pueden ver pedidos', () => {
    expect(rolesFor(OrderController, 'findOne')).toEqual(
      ALL_ORDER_VIEWING_ROLES,
    );
  });

  it('GET /users (usado por el filtro "Asignado a") acepta todos los roles que pueden ver pedidos', () => {
    expect(rolesFor(UserController, 'findAll')).toEqual(
      ALL_ORDER_VIEWING_ROLES,
    );
  });

  it('GET /clients (usado por el filtro de cliente) acepta todos los roles que pueden ver pedidos', () => {
    expect(rolesFor(ClientController, 'findAll')).toEqual(
      ALL_ORDER_VIEWING_ROLES,
    );
  });
});
