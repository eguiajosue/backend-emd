import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSupplierDto } from './create-supplier.dto';

describe('CreateSupplierDto', () => {
  const base = { name: 'Vidrios del Norte', location: 'local' as const };

  it('acepta el caso mínimo (nombre + ubicación)', async () => {
    const dto = plainToInstance(CreateSupplierDto, { ...base });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza sin nombre', async () => {
    const dto = plainToInstance(CreateSupplierDto, { location: 'local' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rechaza una ubicación que no existe', async () => {
    const dto = plainToInstance(CreateSupplierDto, {
      ...base,
      location: 'luna',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'location')).toBe(true);
  });

  it('rechaza un email inválido', async () => {
    const dto = plainToInstance(CreateSupplierDto, {
      ...base,
      email: 'no-es-un-email',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('normaliza email vacío a undefined en vez de rechazarlo', async () => {
    const dto = plainToInstance(CreateSupplierDto, { ...base, email: '   ' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.email).toBeUndefined();
  });
});
