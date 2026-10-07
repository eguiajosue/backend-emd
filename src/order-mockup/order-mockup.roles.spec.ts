import { HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { OrderController } from 'src/order/order.controller';
import { OrderMockupController } from './order-mockup.controller';

/**
 * Roles de `/orders/:id/mockups` vía metadata de Nest (mismo criterio que
 * RolesGuard: handler y, si no hay, clase). Leer = quien ve el detalle del
 * pedido; adjuntar/borrar = sólo Recepción, admin y superuser.
 */
describe('OrderMockupController: roles y contrato de rutas', () => {
  const reflector = new Reflector();

  const rolesFor = (target: any, methodName: string): string[] => {
    const roles: Role[] =
      reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
        target.prototype[methodName],
        target,
      ]) ?? [];
    return [...roles].sort();
  };

  // La cuenta de sucursal también lee el detalle de SUS pedidos (el service
  // la limita a su sucursal).
  const ORDER_DETAIL_ROLES = [
    Role.RECEPCION,
    Role.ADMIN,
    Role.SUPERUSER,
    Role.TALLER,
    Role.DTF,
    Role.BORDADO,
    Role.DISENO,
    Role.LASER,
    Role.IMPRESIONES,
    Role.SUCURSAL,
  ].sort();

  const WRITE_ROLES = [Role.RECEPCION, Role.ADMIN, Role.SUPERUSER].sort();

  it.each([
    ['GET /orders/:id/mockups', 'findAll'],
    ['GET /orders/:id/mockups/:mockupId', 'findOne'],
  ])('%s acepta los mismos roles que GET /orders/:id', (_name, method) => {
    expect(rolesFor(OrderMockupController, method)).toEqual(
      rolesFor(OrderController, 'findOne'),
    );
    expect(rolesFor(OrderMockupController, method)).toEqual(ORDER_DETAIL_ROLES);
  });

  it('POST /orders/:id/mockups acepta recepcion, admin, superuser y sucursal', () => {
    expect(rolesFor(OrderMockupController, 'create')).toEqual(
      [...WRITE_ROLES, Role.SUCURSAL].sort(),
    );
  });

  it('DELETE /orders/:id/mockups/:mockupId sólo acepta recepcion, admin y superuser', () => {
    expect(rolesFor(OrderMockupController, 'remove')).toEqual(WRITE_ROLES);
  });

  it('cuelga de orders/:id/mockups (contrato con el frontend)', () => {
    expect(Reflect.getMetadata(PATH_METADATA, OrderMockupController)).toBe(
      'orders/:id/mockups',
    );
    const proto = OrderMockupController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, proto.findOne)).toBe(':mockupId');
    expect(Reflect.getMetadata(PATH_METADATA, proto.remove)).toBe(':mockupId');
  });

  it('DELETE responde 204 sin cuerpo', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        OrderMockupController.prototype.remove,
      ),
    ).toBe(HttpStatus.NO_CONTENT);
  });
});
