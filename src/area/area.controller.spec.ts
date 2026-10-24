import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AreaController } from './area.controller';
import { CreateAreaDto, SetAreaStagesDto } from './dto/create-area.dto';
import { UpdateAreaDto } from './dto/update-area.dto';

describe('AreaController: permisos', () => {
  const reflector = new Reflector();
  const rolesFor = (method: keyof AreaController) =>
    reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      AreaController.prototype[method] as () => unknown,
      AreaController,
    ]);

  it('leer el catálogo no pide rol: basta con estar autenticado', () => {
    expect(rolesFor('findAll')).toBeUndefined();
  });

  it.each(['overview', 'create', 'update', 'setStages'] as const)(
    '%s sólo para admin y superuser',
    (method) => {
      expect([...rolesFor(method)].sort()).toEqual(
        [Role.ADMIN, Role.SUPERUSER].sort(),
      );
    },
  );
});

describe('CreateAreaDto', () => {
  const valid = { name: 'Impresión 3D', icon: 'Box', color: '#7c3aed' };
  const errorsOf = async (body: object) =>
    (await validate(plainToInstance(CreateAreaDto, body))).map(
      (e) => e.property,
    );

  it('acepta lo mínimo y lo completo', async () => {
    expect(await errorsOf(valid)).toEqual([]);
    expect(
      await errorsOf({
        ...valid,
        isProductionDestination: true,
        hasInventory: true,
        generalViewEnabled: false,
        inventoryCategories: ['Filamento', 'Resina'],
        inventoryUnits: ['kg'],
        createSharedAccount: false,
        userIds: [1, 2],
      }),
    ).toEqual([]);
  });

  it('quita espacios del nombre y de las sugerencias', async () => {
    const dto = plainToInstance(CreateAreaDto, {
      ...valid,
      name: '  Impresión 3D  ',
      inventoryCategories: [' Filamento '],
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.name).toBe('Impresión 3D');
    expect(dto.inventoryCategories).toEqual(['Filamento']);
  });

  it.each([
    ['nombre muy corto', { name: 'A' }, 'name'],
    ['nombre vacío', { name: '   ' }, 'name'],
    ['ícono que no existe', { icon: 'Rocket' }, 'icon'],
    ['color sin #', { color: '7c3aed' }, 'color'],
    ['color corto', { color: '#fff' }, 'color'],
    ['sugerencia vacía', { inventoryUnits: [''] }, 'inventoryUnits'],
    [
      'sugerencias repetidas',
      { inventoryUnits: ['kg', 'kg'] },
      'inventoryUnits',
    ],
    [
      'demasiadas sugerencias',
      { inventoryUnits: Array.from({ length: 21 }, (_, i) => `u${i}`) },
      'inventoryUnits',
    ],
    ['usuario no entero', { userIds: ['a'] }, 'userIds'],
  ])('rechaza %s', async (_label, patch, field) => {
    expect(await errorsOf({ ...valid, ...patch })).toContain(field);
  });
});

describe('UpdateAreaDto', () => {
  it('todo es opcional, pero lo que viene se valida', async () => {
    const check = async (body: object) =>
      (await validate(plainToInstance(UpdateAreaDto, body))).map(
        (e) => e.property,
      );
    expect(await check({})).toEqual([]);
    expect(await check({ active: false, color: '#112233' })).toEqual([]);
    expect(await check({ active: 'no' })).toContain('active');
    expect(await check({ color: 'rojo' })).toContain('color');
  });
});

describe('SetAreaStagesDto', () => {
  const errorsOf = async (body: object) =>
    (await validate(plainToInstance(SetAreaStagesDto, body))).length;

  it('acepta etapas con tipo válido, con o sin id', async () => {
    expect(
      await errorsOf({
        stages: [
          { id: 3, name: 'Digitalizado', kind: 'work' },
          { name: 'En pruebas', kind: 'review' },
        ],
      }),
    ).toBe(0);
    expect(await errorsOf({ stages: [] })).toBe(0);
  });

  it('rechaza tipos desconocidos, nombres vacíos y más de 6 etapas', async () => {
    expect(await errorsOf({ stages: [{ name: 'X1', kind: 'otro' }] })).toBe(1);
    expect(await errorsOf({ stages: [{ name: ' ', kind: 'work' }] })).toBe(1);
    expect(
      await errorsOf({
        stages: Array.from({ length: 7 }, (_, i) => ({
          name: `Etapa ${i}`,
          kind: 'work',
        })),
      }),
    ).toBe(1);
  });
});
