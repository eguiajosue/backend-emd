import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { UserController } from 'src/user/user.controller';
import { ClientController } from 'src/client/client.controller';
import { OrderController } from 'src/order/order.controller';
import { OrderHistoryController } from 'src/order-history/order-history.controller';
import { OrderProductController } from 'src/order-product/order-product.controller';
import { OrderProductPresetController } from 'src/order-product-preset/order-product-preset.controller';
import { StatusController } from 'src/status/status.controller';
import { ProductController } from 'src/product/product.controller';
import { ProductTypeController } from 'src/product-type/product-type.controller';
import { ColorController } from 'src/color/color.controller';
import { SizeController } from 'src/size/size.controller';
import { AreaVisibilityController } from 'src/area-visibility/area-visibility.controller';
import { NotificationController } from 'src/notification/notification.controller';
import { ORDER_VIEWING_ROLES } from 'src/common/constants/order-viewing-roles';

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

  it('la constante compartida ORDER_VIEWING_ROLES contiene los 9 roles', () => {
    expect([...ORDER_VIEWING_ROLES].sort()).toEqual(ALL_ORDER_VIEWING_ROLES);
  });

  // Mismo criterio que RolesGuard: metadata del handler y, si no hay, la de la
  // clase (getAllAndOverride([handler, class])).
  const rolesFor = (target: any, methodName: string): string[] => {
    const roles: Role[] =
      reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
        target.prototype[methodName],
        target,
      ]) ?? [];
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

  // Todos los endpoints de SOLO LECTURA que la pantalla de Pedidos (listado y
  // detalle) puede consultar durante su uso normal. Si alguno pierde los roles
  // operativos vuelve a aparecer el 403 en la sección completa.
  const READ_ENDPOINTS: Array<[string, any, string]> = [
    ['GET /orders', OrderController, 'findAll'],
    ['GET /orders/:id', OrderController, 'findOne'],
    ['GET /orders/history', OrderController, 'findHistory'],
    ['GET /users', UserController, 'findAll'],
    ['GET /users/:id', UserController, 'findOne'],
    ['GET /clients', ClientController, 'findAll'],
    ['GET /clients/:id', ClientController, 'findOne'],
    ['GET /clients/:id/orders', ClientController, 'findOrders'],
    ['GET /order-histories', OrderHistoryController, 'findAll'],
    ['GET /order-products', OrderProductController, 'findAll'],
    [
      'GET /order-products/:orderId/:productId',
      OrderProductController,
      'findOne',
    ],
    ['GET /order-product-presets', OrderProductPresetController, 'findAll'],
    ['GET /status', StatusController, 'findAll'],
    ['GET /status/:id', StatusController, 'findOne'],
    ['GET /products', ProductController, 'findAll'],
    ['GET /products/:id', ProductController, 'findOne'],
    ['GET /product-types', ProductTypeController, 'findAll'],
    ['GET /product-types/:id', ProductTypeController, 'findOne'],
    ['GET /colors', ColorController, 'findAll'],
    ['GET /colors/:id', ColorController, 'findOne'],
    ['GET /sizes', SizeController, 'findAll'],
    ['GET /sizes/:id', SizeController, 'findOne'],
    ['GET /area-visibility', AreaVisibilityController, 'findAll'],
    ['GET /notifications', NotificationController, 'findAll'],
    ['GET /notifications/unread-count', NotificationController, 'unreadCount'],
  ];

  it.each(READ_ENDPOINTS)(
    '%s acepta todos los roles que pueden ver pedidos',
    (_name, controller, method) => {
      expect(rolesFor(controller, method)).toEqual(ALL_ORDER_VIEWING_ROLES);
    },
  );
});
