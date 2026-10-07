import { readdirSync } from 'fs';
import { join } from 'path';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { InventoryController } from 'src/inventory/inventory.controller';
import { ClientController } from 'src/client/client.controller';
import { OrderProductPresetController } from 'src/order-product-preset/order-product-preset.controller';

/**
 * Auditoría de TODA la superficie HTTP para la cuenta de sucursal: recorre
 * cada controller y compara las rutas que le abren el paso con una lista
 * cerrada. Si alguien le abre a la sucursal una ruta nueva (p. ej. inventario,
 * reabasto, bitácora, escáner o la hoja de materiales de la matriz) este test
 * falla y obliga a revisarlo.
 */
describe('Rol sucursal: superficie completa de la API', () => {
  const reflector = new Reflector();
  const srcDir = join(__dirname, '..');

  const controllers: { name: string; ctrl: any }[] = [];
  for (const dir of readdirSync(srcDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of readdirSync(join(srcDir, dir.name))) {
      if (!file.endsWith('.controller.ts')) continue;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(join(srcDir, dir.name, file));
      for (const exported of Object.values(mod)) {
        if (
          typeof exported === 'function' &&
          Reflect.getMetadata(PATH_METADATA, exported) !== undefined &&
          exported.name.endsWith('Controller')
        ) {
          controllers.push({ name: exported.name, ctrl: exported });
        }
      }
    }
  }

  const sucursalRoutes: string[] = [];
  for (const { name, ctrl } of controllers) {
    for (const method of Object.getOwnPropertyNames(ctrl.prototype)) {
      if (method === 'constructor') continue;
      const handler = ctrl.prototype[method];
      if (typeof handler !== 'function') continue;
      const roles =
        reflector.getAllAndOverride<Role[]>(ROLES_KEY, [handler, ctrl]) ?? [];
      if (roles.includes(Role.SUCURSAL))
        sucursalRoutes.push(`${name}.${method}`);
    }
  }

  it('encuentra los controllers (sanidad del recorrido)', () => {
    expect(controllers.length).toBeGreaterThan(20);
  });

  it('ningún controller de inventario/reabasto/bitácora/materiales le abre el paso', () => {
    const forbidden =
      /^(Inventory|Material|MaterialCategory|MaterialUnit|Supplier|Log|AuditLog|Dashboard|Performance|Quote|ClientInsight|OrderTemplate|Company|Calendar|Chat|Settings|AreaVisibility|OrderHistory)/;
    expect(sucursalRoutes.filter((r) => forbidden.test(r))).toEqual([]);
  });

  it('TODAS las rutas de /inventory responden 403 a sucursal', () => {
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

  it('los endpoints de inventario/materiales/reabasto de /orders no son de sucursal', () => {
    const orderRoutes = sucursalRoutes.filter((r) =>
      r.startsWith('OrderController.'),
    );
    expect(orderRoutes.join(' ')).not.toMatch(
      /[Ss]upply|[Ss]upplies|[Mm]aterial|[Rr]estock|[Bb]arcode|[Ii]nventory/,
    );
  });

  it('lista cerrada de rutas abiertas a sucursal', () => {
    expect(sucursalRoutes.sort()).toMatchSnapshot();
  });

  it('clientes: leer/crear/editar sí; borrar y pedidos del cliente no', () => {
    const has = (c: any, m: string) =>
      (
        reflector.getAllAndOverride<Role[]>(ROLES_KEY, [c.prototype[m], c]) ??
        []
      ).includes(Role.SUCURSAL);
    expect(has(ClientController, 'findAll')).toBe(true);
    expect(has(ClientController, 'findOne')).toBe(true);
    expect(has(ClientController, 'create')).toBe(true);
    expect(has(ClientController, 'update')).toBe(true);
    expect(has(ClientController, 'remove')).toBe(false);
    expect(has(ClientController, 'findOrders')).toBe(false);
    expect(has(OrderProductPresetController, 'create')).toBe(true);
  });
});
