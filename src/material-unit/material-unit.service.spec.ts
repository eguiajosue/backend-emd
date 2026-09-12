import { MaterialUnitService } from './material-unit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MaterialUnitService', () => {
  let service: MaterialUnitService;
  let prisma: { materialUnit: { findMany: jest.Mock; upsert: jest.Mock } };

  beforeEach(() => {
    prisma = {
      materialUnit: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn((args: { create: { name: string } }) => ({
          id: 1,
          name: args.create.name,
        })),
      },
    };
    service = new MaterialUnitService(prisma as unknown as PrismaService);
  });

  it('crea la unidad si no existe (upsert por nombre)', async () => {
    const id = await service.ensureExists('Hoja');
    expect(prisma.materialUnit.upsert).toHaveBeenCalledWith({
      where: { name: 'Hoja' },
      update: {},
      create: { name: 'Hoja' },
    });
    expect(id).toBe(1);
  });
});
