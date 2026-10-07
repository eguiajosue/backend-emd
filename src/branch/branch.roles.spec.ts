import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { OrderController } from 'src/order/order.controller';
import { OrderMockupController } from 'src/order-mockup/order-mockup.controller';
import { MockupTemplateController } from 'src/mockup-template/mockup-template.controller';
import { MockupLogoController } from 'src/mockup-logo/mockup-logo.controller';
import { ClientController } from 'src/client/client.controller';
import { UserController } from 'src/user/user.controller';
import { StatusController } from 'src/status/status.controller';
import { OrderProductPresetController } from 'src/order-product-preset/order-product-preset.controller';
import { NotificationController } from 'src/notification/notification.controller';
import { BranchController } from './branch.controller';

/**
 * Matriz de la cuenta de sucursal: puede levantar pedidos, usar Mockups y
 * ver SUS pedidos (lectura); todo lo demás le responde 403 por RolesGuard.
 */
describe('Rol sucursal: rutas permitidas y prohibidas', () => {
  const reflector = new Reflector();
  const allowed = (target: any, method: string): boolean => {
    const roles =
      reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
        target.prototype[method],
        target,
      ]) ?? [];
    return roles.includes(Role.SUCURSAL);
  };

  it.each([
    ['POST /orders', OrderController, 'create'],
    ['GET /orders', OrderController, 'findAll'],
    ['GET /orders/:id', OrderController, 'findOne'],
    ['GET /orders/:id/area-tasks', OrderController, 'getAreaTasks'],
    ['GET /orders/:id/design-revisions', OrderController, 'getDesignRevisions'],
    ['GET montage', OrderController, 'getDesignRevisionMontage'],
    ['GET /orders/:id/mockups', OrderMockupController, 'findAll'],
    ['POST /orders/:id/mockups', OrderMockupController, 'create'],
    ['GET /mockup-templates', MockupTemplateController, 'findAll'],
    ['POST /mockup-templates', MockupTemplateController, 'create'],
    ['GET /mockup-logos', MockupLogoController, 'findAll'],
    ['POST /mockup-logos', MockupLogoController, 'create'],
    ['GET /clients', ClientController, 'findAll'],
    ['POST /clients', ClientController, 'create'],
    ['GET /clients/:id', ClientController, 'findOne'],
    ['PATCH /clients/:id', ClientController, 'update'],
    ['POST /order-product-presets', OrderProductPresetController, 'create'],
    ['GET /users', UserController, 'findAll'],
    ['GET /status', StatusController, 'findAll'],
    ['GET /order-product-presets', OrderProductPresetController, 'findAll'],
    ['GET /notifications', NotificationController, 'findAll'],
    ['GET /branches/me', BranchController, 'findMine'],
    ['GET /branches/logos', BranchController, 'findLogos'],
  ])('permite %s', (_n, c, m) => {
    expect(allowed(c, m)).toBe(true);
  });

  it.each([
    ['PATCH /orders/:id', OrderController, 'update'],
    ['DELETE /orders/:id', OrderController, 'remove'],
    ['GET /orders/export', OrderController, 'exportOrders'],
    ['GET /orders/history', OrderController, 'findHistory'],
    ['GET /orders/my-tasks', OrderController, 'getMyTasks'],
    ['POST /orders/:id/notes', OrderController, 'createNote'],
    ['GET /orders/:id/audit-log', OrderController, 'getAuditLog'],
    ['GET /orders/:id/materials', OrderController, 'getMaterialItems'],
    ['POST /orders/bulk-actions', OrderController, 'bulkActions'],
    ['DELETE /orders/:id/mockups/:id', OrderMockupController, 'remove'],
    ['PATCH /mockup-templates/:id', MockupTemplateController, 'rename'],
    ['DELETE /mockup-logos/:id', MockupLogoController, 'remove'],
    ['DELETE /clients/:id', ClientController, 'remove'],
    ['GET /clients/:id/orders', ClientController, 'findOrders'],
    ['POST /users', UserController, 'create'],
    ['GET /branches', BranchController, 'findAll'],
    ['POST /branches', BranchController, 'create'],
    ['PATCH /branches/:id', BranchController, 'update'],
    ['GET /branches/:id/employees', BranchController, 'findEmployees'],
    ['POST /branches/:id/employees', BranchController, 'createEmployee'],
    ['PATCH employee', BranchController, 'updateEmployee'],
    ['PUT /branches/:id/logo/:variant', BranchController, 'setLogo'],
    ['DELETE /branches/:id/logo/:variant', BranchController, 'removeLogo'],
  ])('prohíbe %s', (_n, c, m) => {
    expect(allowed(c, m)).toBe(false);
  });

  it('administrar sucursales y empleados es sólo de admin/superuser', () => {
    for (const m of [
      'setLogo',
      'removeLogo',
      'create',
      'update',
      'findEmployees',
      'createEmployee',
      'updateEmployee',
    ]) {
      const roles =
        reflector.get<Role[]>(
          ROLES_KEY,
          BranchController.prototype[m as 'create'],
        ) ?? [];
      expect([...roles].sort()).toEqual([Role.ADMIN, Role.SUPERUSER].sort());
    }
  });

  it('subir y quitar logos: sólo admin y superuser (Recepción y áreas no)', () => {
    for (const m of ['setLogo', 'removeLogo'] as const) {
      const roles =
        reflector.get<Role[]>(ROLES_KEY, BranchController.prototype[m]) ?? [];
      expect([...roles].sort()).toEqual([Role.ADMIN, Role.SUPERUSER].sort());
      for (const denied of [
        Role.RECEPCION,
        Role.DISENO,
        Role.TALLER,
        Role.SUCURSAL,
      ]) {
        expect(roles).not.toContain(denied);
      }
    }
  });

  it('GET /branches/logos lo lee TODO rol (producción, TV y sucursal)', () => {
    const roles =
      reflector.get<Role[]>(ROLES_KEY, BranchController.prototype.findLogos) ??
      [];
    expect([...roles].sort()).toEqual(Object.values(Role).sort());
  });

  it('PUT del logo tiene throttle estricto (20/min) y el GET de logos cache privada', () => {
    expect(
      Reflect.getMetadata(
        'THROTTLER:LIMITdefault',
        BranchController.prototype.setLogo,
      ),
    ).toBe(20);
    expect(
      Reflect.getMetadata('__headers__', BranchController.prototype.findLogos),
    ).toEqual([{ name: 'Cache-Control', value: 'private, max-age=300' }]);
  });

  it('"logos" y "me" se declaran antes que las rutas con :id', () => {
    const names = Object.getOwnPropertyNames(BranchController.prototype);
    const first = (m: string) => names.indexOf(m);
    for (const withId of ['update', 'setLogo', 'removeLogo', 'findEmployees']) {
      expect(first('findLogos')).toBeLessThan(first(withId));
      expect(first('findMine')).toBeLessThan(first(withId));
    }
  });
});
