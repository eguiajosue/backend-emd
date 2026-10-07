import { Reflector } from '@nestjs/core';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { OrderProductPresetController } from './order-product-preset.controller';
import { CreateOrderProductPresetDto } from './dto/create-order-product-preset.dto';

describe('POST /order-product-presets', () => {
  const reflector = new Reflector();
  const roles = (m: string) =>
    reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      (OrderProductPresetController.prototype as any)[m],
      OrderProductPresetController,
    ]) ?? [];

  it('lo usan quienes pueden crear pedidos: admin, superuser, recepción y sucursal', () => {
    expect([...roles('create')].sort()).toEqual(
      [Role.ADMIN, Role.SUPERUSER, Role.RECEPCION, Role.SUCURSAL].sort(),
    );
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        OrderProductPresetController.prototype.create,
      ),
    ).toBe(RequestMethod.POST);
  });

  it('no hay DELETE ni PATCH global del catálogo', () => {
    const names = Object.getOwnPropertyNames(
      OrderProductPresetController.prototype,
    );
    expect(names.sort()).toEqual(['constructor', 'create', 'findAll']);
  });

  it('delega en findOrCreate y refresca el caché del GET', async () => {
    const service: any = {
      findOrCreate: jest
        .fn()
        .mockResolvedValue({ id: 1, name: 'Gorra', uses: 0 }),
    };
    const controller = new OrderProductPresetController(service);
    await expect(controller.create({ name: 'Gorra' })).resolves.toEqual({
      id: 1,
      name: 'Gorra',
      uses: 0,
    });
    expect(service.findOrCreate).toHaveBeenCalledWith('Gorra');
  });

  describe('validación del body', () => {
    const check = async (name: unknown) =>
      validate(plainToInstance(CreateOrderProductPresetDto, { name }));

    it('acepta 1 a 80 caracteres y recorta espacios', async () => {
      expect(await check('  Gorra  ')).toHaveLength(0);
      expect(await check('x'.repeat(80))).toHaveLength(0);
      expect(
        plainToInstance(CreateOrderProductPresetDto, { name: '  Gorra  ' })
          .name,
      ).toBe('Gorra');
    });

    it.each([[''], ['   '], ['x'.repeat(81)], [undefined], [123]])(
      'rechaza %p',
      async (v) => {
        expect((await check(v)).length).toBeGreaterThan(0);
      },
    );
  });
});
