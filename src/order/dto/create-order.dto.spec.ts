import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto } from './create-order.dto';

/**
 * Antes `orderProducts` era opcional: un pedido podía crearse sin ningún
 * producto sin que el DTO lo rechazara (ver auditoría UX del wizard de
 * pedidos). Ahora es obligatorio con al menos un elemento.
 */
describe('CreateOrderDto.orderProducts', () => {
  const base = {
    clientNameOverride: 'Juan',
    statusId: 1,
    description: 'Remeras',
    requiresDesign: false,
    area: 'taller',
  };

  it('rechaza un pedido sin orderProducts', async () => {
    const dto = plainToInstance(CreateOrderDto, { ...base });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'orderProducts')).toBe(true);
  });

  it('rechaza un pedido con orderProducts vacío', async () => {
    const dto = plainToInstance(CreateOrderDto, { ...base, orderProducts: [] });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'orderProducts')).toBe(true);
  });

  it('acepta un pedido con al menos un producto', async () => {
    const dto = plainToInstance(CreateOrderDto, {
      ...base,
      orderProducts: [{ customName: 'Remera', quantity: 1 }],
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'orderProducts')).toBe(false);
  });
});
