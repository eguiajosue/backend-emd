import { Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { InventoryController } from './inventory.controller';

/**
 * Roles de `/inventory` vía metadata de Nest (mismo criterio que RolesGuard:
 * handler y, si no hay, clase). Las áreas de producción (taller, dtf,
 * bordado, láser, impresiones) entran a consultar SU inventario, registrar
 * entradas/consumos y avisar reabasto; el servicio recorta por área. Altas,
 * ediciones, bajas, exportación, bitácora y el cambio de estado del reabasto
 * son sólo de Recepción, admin y superuser. Diseño no entra (403).
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

  const MANAGERS = [Role.RECEPCION, Role.ADMIN, Role.SUPERUSER].sort();
  const WITH_AREAS = [
    ...MANAGERS,
    Role.TALLER,
    Role.DTF,
    Role.BORDADO,
    Role.LASER,
    Role.IMPRESIONES,
  ].sort();

  // [nombre, handler, verbo, ruta, ¿áreas de producción?]
  const ROUTES: [string, string, RequestMethod, string, boolean][] = [
    ['GET /inventory/areas', 'areas', RequestMethod.GET, 'areas', true],
    ['GET /inventory', 'findAll', RequestMethod.GET, '/', true],
    [
      'GET /inventory/movements',
      'movements',
      RequestMethod.GET,
      'movements',
      false,
    ],
    ['GET /inventory/export', 'export', RequestMethod.GET, 'export', false],
    [
      'GET /inventory/restock-requests',
      'restockRequests',
      RequestMethod.GET,
      'restock-requests',
      true,
    ],
    [
      'GET /inventory/restock-requests/count',
      'restockCount',
      RequestMethod.GET,
      'restock-requests/count',
      true,
    ],
    [
      'POST /inventory/restock-requests',
      'createRestockRequest',
      RequestMethod.POST,
      'restock-requests',
      true,
    ],
    [
      'PATCH /inventory/restock-requests/:id',
      'updateRestockStatus',
      RequestMethod.PATCH,
      'restock-requests/:id',
      false,
    ],
    [
      'GET /inventory/items/by-barcode/:code',
      'findByBarcode',
      RequestMethod.GET,
      'items/by-barcode/:code',
      true,
    ],
    [
      'POST /inventory/items/by-barcode/:code/movements',
      'registerMovementByBarcode',
      RequestMethod.POST,
      'items/by-barcode/:code/movements',
      true,
    ],
    ['GET /inventory/:id', 'findOne', RequestMethod.GET, ':id', true],
    [
      'GET /inventory/:id/movements',
      'itemMovements',
      RequestMethod.GET,
      ':id/movements',
      false,
    ],
    ['POST /inventory', 'create', RequestMethod.POST, '/', false],
    [
      'POST /inventory/:id/movements',
      'registerMovement',
      RequestMethod.POST,
      ':id/movements',
      true,
    ],
    ['PATCH /inventory/:id', 'update', RequestMethod.PATCH, ':id', false],
    ['DELETE /inventory/:id', 'remove', RequestMethod.DELETE, ':id', false],
  ];

  it.each(ROUTES)('%s: roles permitidos', (_name, method, _v, _p, areas) => {
    expect(rolesFor(method)).toEqual(areas ? WITH_AREAS : MANAGERS);
  });

  it('Diseño no entra a ninguna ruta (403)', () => {
    for (const [, method] of ROUTES) {
      expect(rolesFor(method)).not.toContain(Role.DISENO);
    }
  });

  it('las rutas de restock-requests se declaran antes de :id', () => {
    const names = Object.getOwnPropertyNames(InventoryController.prototype);
    expect(names.indexOf('restockRequests')).toBeLessThan(
      names.indexOf('findOne'),
    );
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

describe('InventoryController: la cuenta de sucursal no entra (403)', () => {
  const reflector = new Reflector();
  it('ninguna ruta de /inventory (ni reabasto, bitácora, escáner) incluye sucursal', () => {
    const methods = Object.getOwnPropertyNames(
      InventoryController.prototype,
    ).filter((m) => m !== 'constructor');
    expect(methods.length).toBeGreaterThan(10);
    for (const m of methods) {
      const roles =
        reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
          (InventoryController.prototype as any)[m],
          InventoryController,
        ]) ?? [];
      expect(roles).not.toContain(Role.SUCURSAL);
    }
  });
});
