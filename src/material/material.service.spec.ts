import { HttpException } from '@nestjs/common';
import { MaterialService } from './material.service';
import { PrismaService } from '../prisma/prisma.service';
import { MaterialCategoryService } from '../material-category/material-category.service';
import { MaterialUnitService } from '../material-unit/material-unit.service';

describe('MaterialService', () => {
  let service: MaterialService;
  let prisma: {
    material: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let categoryService: { ensureExists: jest.Mock };
  let unitService: { ensureExists: jest.Mock };

  beforeEach(() => {
    prisma = {
      material: {
        create: jest.fn((args: { data: unknown }) => ({
          id: 1,
          ...(args.data as object),
        })),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn((args: { data: unknown }) => ({
          id: 1,
          ...(args.data as object),
        })),
        delete: jest.fn(),
      },
    };
    categoryService = { ensureExists: jest.fn().mockResolvedValue(10) };
    unitService = { ensureExists: jest.fn().mockResolvedValue(20) };
    service = new MaterialService(
      prisma as unknown as PrismaService,
      categoryService as unknown as MaterialCategoryService,
      unitService as unknown as MaterialUnitService,
    );
  });

  it('resuelve categoría y unidad por nombre antes de crear', async () => {
    await service.create({
      name: 'PVC',
      category: 'Lámina/Panel',
      unit: 'Hoja',
      measure: '6mm',
      areas: ['taller'],
    });
    expect(categoryService.ensureExists).toHaveBeenCalledWith('Lámina/Panel');
    expect(unitService.ensureExists).toHaveBeenCalledWith('Hoja');
    expect(prisma.material.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          categoryId: 10,
          unitId: 20,
          name: 'PVC',
        }),
      }),
    );
  });

  it('permite crear sin categoría/unidad/áreas', async () => {
    await service.create({ name: 'Gasolina' });
    expect(categoryService.ensureExists).not.toHaveBeenCalled();
    expect(unitService.ensureExists).not.toHaveBeenCalled();
    expect(prisma.material.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ areas: [] }),
      }),
    );
  });

  it('lanza 404 al actualizar un material inexistente', async () => {
    prisma.material.findUnique.mockResolvedValue(null);
    await expect(service.update(999, { name: 'X' })).rejects.toThrow(
      HttpException,
    );
  });

  it('permite varias áreas por material', async () => {
    await service.create({ name: 'Tornillería', areas: ['taller', 'bordado'] });
    expect(prisma.material.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ areas: ['taller', 'bordado'] }),
      }),
    );
  });

  it('lanza 400 al borrar un material referenciado por una hoja de materiales', async () => {
    prisma.material.findUnique.mockResolvedValue({ id: 1 });
    prisma.material.delete.mockRejectedValue({ code: 'P2003' });
    await expect(service.remove(1)).rejects.toThrow(HttpException);
  });
});
