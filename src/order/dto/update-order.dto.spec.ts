import { plainToInstance } from 'class-transformer';
import { UpdateOrderDto } from './update-order.dto';
import { CreateOrderDto } from './create-order.dto';

/**
 * PATCH parcial = sólo lo que vino en el body. `PartialType` hereda los
 * inicializadores de `CreateOrderDto`, y con `statusId = 1` / `requiresDesign
 * = true` ahí, cualquier edición (fecha, descripción, asignado) devolvía el
 * pedido a "pendiente" y lo marcaba como "requiere diseño".
 */
describe('UpdateOrderDto', () => {
  it('no inventa campos que no vinieron en el body', () => {
    const dto = plainToInstance(UpdateOrderDto, { description: 'nueva' });
    expect(dto.statusId).toBeUndefined();
    expect(dto.requiresDesign).toBeUndefined();
  });

  it('respeta los que sí vinieron', () => {
    const dto = plainToInstance(UpdateOrderDto, {
      statusId: 3,
      requiresDesign: false,
    });
    expect(dto.statusId).toBe(3);
    expect(dto.requiresDesign).toBe(false);
  });
});

describe('CreateOrderDto', () => {
  it('statusId y requiresDesign son opcionales al crear (el servicio pone los defaults)', () => {
    const dto = plainToInstance(CreateOrderDto, { description: 'x' });
    expect(dto.statusId).toBeUndefined();
  });
});
