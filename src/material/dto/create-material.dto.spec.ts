import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMaterialDto } from './create-material.dto';

describe('CreateMaterialDto', () => {
  it('acepta el caso mínimo (sólo nombre)', async () => {
    const dto = plainToInstance(CreateMaterialDto, { name: 'PVC' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza sin nombre', async () => {
    const dto = plainToInstance(CreateMaterialDto, { measure: '6mm' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('acepta varias áreas válidas', async () => {
    const dto = plainToInstance(CreateMaterialDto, {
      name: 'Tornillería',
      areas: ['taller', 'bordado'],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza un área que no existe', async () => {
    const dto = plainToInstance(CreateMaterialDto, {
      name: 'X',
      areas: ['cocina'],
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'areas')).toBe(true);
  });
});
