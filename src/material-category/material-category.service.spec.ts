import { MaterialCategoryService } from './material-category.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MaterialCategoryService', () => {
  let service: MaterialCategoryService;
  let prisma: { materialCategory: { findMany: jest.Mock; upsert: jest.Mock } };

  beforeEach(() => {
    prisma = {
      materialCategory: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn((args: { create: { name: string } }) => ({
          id: 1,
          name: args.create.name,
        })),
      },
    };
    service = new MaterialCategoryService(prisma as unknown as PrismaService);
  });

  it('crea la categoría si no existe (upsert por nombre)', async () => {
    const id = await service.ensureExists('Lámina/Panel');
    expect(prisma.materialCategory.upsert).toHaveBeenCalledWith({
      where: { name: 'Lámina/Panel' },
      update: {},
      create: { name: 'Lámina/Panel' },
    });
    expect(id).toBe(1);
  });

  it('recorta espacios antes de buscar/crear', async () => {
    await service.ensureExists('  Abrasivos/Corte  ');
    expect(prisma.materialCategory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'Abrasivos/Corte' } }),
    );
  });
});
