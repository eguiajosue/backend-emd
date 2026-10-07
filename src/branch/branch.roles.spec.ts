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
    ['GET /users', UserController, 'findAll'],
    ['GET /status', StatusController, 'findAll'],
    ['GET /order-product-presets', OrderProductPresetController, 'findAll'],
    ['GET /notifications', NotificationController, 'findAll'],
    ['GET /branches/me', BranchController, 'findMine'],
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
    ['PATCH /clients/:id', ClientController, 'update'],
    ['DELETE /clients/:id', ClientController, 'remove'],
    ['POST /users', UserController, 'create'],
    ['GET /branches', BranchController, 'findAll'],
    ['POST /branches', BranchController, 'create'],
    ['PATCH /branches/:id', BranchController, 'update'],
    ['GET /branches/:id/employees', BranchController, 'findEmployees'],
    ['POST /branches/:id/employees', BranchController, 'createEmployee'],
    ['PATCH employee', BranchController, 'updateEmployee'],
  ])('prohíbe %s', (_n, c, m) => {
    expect(allowed(c, m)).toBe(false);
  });

  it('administrar sucursales y empleados es sólo de admin/superuser', () => {
    for (const m of [
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
});
