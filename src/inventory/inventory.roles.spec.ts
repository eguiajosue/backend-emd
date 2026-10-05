import { Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { InventoryController } from './inventory.controller';

/**
 * Roles de `/inventory` vía metadata de Nest (mismo criterio que RolesGuard:
 * handler y, si no hay, clase). Todo el inventario (incluidos el escaneo por
 * código de barras y el movimiento por código) es sólo de Recepción, admin y
 * superuser; el resto de las áreas recibe 403.
 */
describe('InventoryController: roles y contrato de rutas', () => {
  const reflector = new Reflector();

  const rolesFor = (methodName: string): string[] => {
    const roles: Role[] =
      reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
        (InventoryController.prototype as any)[methodName],
        InventoryController,
      ]) ?? [];
    return [...roles].sort();
  };

  const INVENTORY_ROLES = [Role.RECEPCION, Role.ADMIN, Role.SUPERUSER].sort();

  const ROUTES: [string, string, RequestMethod, string][] = [
    ['GET /inventory/areas', 'areas', RequestMethod.GET, 'areas'],
    ['GET /inventory', 'findAll', RequestMethod.GET, '/'],
    ['GET /inventory/movements', 'movements', RequestMethod.GET, 'movements'],
    ['GET /inventory/export', 'export', RequestMethod.GET, 'export'],
    [
      'GET /inventory/items/by-barcode/:code',
      'findByBarcode',
      RequestMethod.GET,
      'items/by-barcode/:code',
    ],
    [
      'POST /inventory/items/by-barcode/:code/movements',
      'registerMovementByBarcode',
      RequestMethod.POST,
      'items/by-barcode/:code/movements',
    ],
    ['GET /inventory/:id', 'findOne', RequestMethod.GET, ':id'],
    [
      'GET /inventory/:id/movements',
      'itemMovements',
      RequestMethod.GET,
      ':id/movements',
    ],
    ['POST /inventory', 'create', RequestMethod.POST, '/'],
    [
      'POST /inventory/:id/movements',
      'registerMovement',
      RequestMethod.POST,
      ':id/movements',
    ],
    ['PATCH /inventory/:id', 'update', RequestMethod.PATCH, ':id'],
    ['DELETE /inventory/:id', 'remove', RequestMethod.DELETE, ':id'],
  ];

  it.each(ROUTES)(
    '%s sólo acepta recepcion, admin y superuser',
    (_name, method) => {
      expect(rolesFor(method)).toEqual(INVENTORY_ROLES);
    },
  );

  it.each(
    Object.values(Role).filter(
      (role) => ![Role.RECEPCION, Role.ADMIN, Role.SUPERUSER].includes(role),
    ),
  )('el rol %s no entra a ninguna ruta (403)', (role) => {
    for (const [, method] of ROUTES) {
      expect(rolesFor(method)).not.toContain(role);
    }
  });

  it.each(ROUTES)(
    '%s (contrato con el frontend)',
    (_name, method, verb, path) => {
      const handler = (InventoryController.prototype as any)[method];
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(verb);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    },
  );

  it('cuelga de inventory', () => {
    expect(Reflect.getMetadata(PATH_METADATA, InventoryController)).toBe(
      'inventory',
    );
  });
});
