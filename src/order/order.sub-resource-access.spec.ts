import { HttpException, HttpStatus } from '@nestjs/common';
import { OrderController } from './order.controller';

/**
 * Regresión: GET /orders/:id/area-tasks y /orders/:id/materials deben aplicar
 * la misma visibilidad por área que GET /orders/:id (assertOrderAccess).
 */
describe('OrderController sub-resource access', () => {
  const user = { sub: 7, username: 'taller1', roles: ['taller'] };
  let orderService: { assertOrderAccess: jest.Mock };
  let areaTasks: { findByOrder: jest.Mock };
  let materials: { findByOrder: jest.Mock };
  let controller: OrderController;

  beforeEach(() => {
    orderService = { assertOrderAccess: jest.fn() };
    areaTasks = { findByOrder: jest.fn().mockResolvedValue(['task']) };
    materials = { findByOrder: jest.fn().mockResolvedValue(['item']) };
    controller = new OrderController(
      orderService as any,
      areaTasks as any,
      materials as any,
    );
  });

  const forbidden = () =>
    new HttpException('Sin acceso a este pedido', HttpStatus.FORBIDDEN);

  it('denies area tasks of an order the user cannot see', async () => {
    orderService.assertOrderAccess.mockRejectedValue(forbidden());
    await expect(controller.getAreaTasks('42', user)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    expect(orderService.assertOrderAccess).toHaveBeenCalledWith(42, {
      userId: 7,
      roles: ['taller'],
    });
    expect(areaTasks.findByOrder).not.toHaveBeenCalled();
  });

  it('denies materials of an order the user cannot see', async () => {
    orderService.assertOrderAccess.mockRejectedValue(forbidden());
    await expect(controller.getMaterialItems('42', user)).rejects.toMatchObject(
      {
        status: HttpStatus.FORBIDDEN,
      },
    );
    expect(materials.findByOrder).not.toHaveBeenCalled();
  });

  it('returns sub-resources for a visible order', async () => {
    orderService.assertOrderAccess.mockResolvedValue({ id: 42 });
    await expect(controller.getAreaTasks('42', user)).resolves.toEqual([
      'task',
    ]);
    await expect(controller.getMaterialItems('42', user)).resolves.toEqual([
      'item',
    ]);
  });
});
