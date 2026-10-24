import { HttpException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AreaService, defaultAreaViews, type AreaView } from './area.service';

describe('AreaService', () => {
  const withNew = (): AreaView[] => [
    ...defaultAreaViews(),
    {
      ...defaultAreaViews()[0],
      id: 7,
      slug: 'impresion-3d',
      name: 'Impresión 3D',
      sortOrder: 70,
    },
    {
      ...defaultAreaViews()[0],
      id: 8,
      slug: 'serigrafia',
      name: 'Serigrafía',
      active: false,
      sortOrder: 80,
    },
  ];

  it('slugs: las activas; "production" deja fuera a Diseño', async () => {
    const service = AreaService.inMemory(withNew());
    expect(await service.slugs()).toEqual([
      'taller',
      'dtf',
      'bordado',
      'diseno',
      'laser',
      'impresiones',
      'impresion-3d',
    ]);
    expect(await service.slugs('production')).not.toContain('diseno');
    expect(await service.slugs('production')).toContain('impresion-3d');
  });

  it('findAll sólo suma las desactivadas si se piden', async () => {
    const service = AreaService.inMemory(withNew());
    expect((await service.findAll()).map((a) => a.slug)).not.toContain(
      'serigrafia',
    );
    expect(
      (await service.findAll({ includeInactive: true })).map((a) => a.slug),
    ).toContain('serigrafia');
  });

  it('assertArea: 400 para un área desconocida o desactivada, nada si viene vacía', async () => {
    const service = AreaService.inMemory(withNew());
    await expect(service.assertArea('impresion-3d')).resolves.toBeUndefined();
    await expect(service.assertArea(undefined)).resolves.toBeUndefined();
    await expect(service.assertArea('cocina')).rejects.toBeInstanceOf(
      HttpException,
    );
    await expect(service.assertArea('serigrafia')).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      service.assertArea('diseno', 'production', 'productionArea'),
    ).rejects.toThrow(/productionArea inválida: "diseno"/);
  });

  it('labelOf: el nombre del catálogo, o el slug si no está', async () => {
    const service = AreaService.inMemory(withNew());
    expect(await service.labelOf('impresion-3d')).toBe('Impresión 3D');
    expect(await service.labelOf('vieja')).toBe('vieja');
    expect(await service.labelOf(null)).toBe('Área');
  });

  describe('con la base', () => {
    let prisma: { area: Record<string, jest.Mock> };
    let service: AreaService;

    beforeEach(() => {
      prisma = {
        area: {
          findMany: jest.fn().mockResolvedValue(defaultAreaViews()),
          findUnique: jest.fn(),
          update: jest.fn(),
        },
      };
      service = new AreaService(prisma as unknown as PrismaService);
    });

    it('guarda el catálogo en memoria entre lecturas', async () => {
      await service.slugs();
      await service.slugs('production');
      expect(prisma.area.findMany).toHaveBeenCalledTimes(1);
    });

    it('vuelve a leer la base después de un cambio de visibilidad', async () => {
      await service.slugs();
      prisma.area.findUnique.mockResolvedValue({ id: 1, slug: 'taller' });
      prisma.area.update.mockResolvedValue({
        ...defaultAreaViews()[0],
        generalViewEnabled: false,
      });

      const updated = await service.setGeneralView('taller', false);

      expect(updated?.generalViewEnabled).toBe(false);
      await service.slugs();
      expect(prisma.area.findMany).toHaveBeenCalledTimes(2);
    });

    it('setGeneralView devuelve null si el área no existe', async () => {
      prisma.area.findUnique.mockResolvedValue(null);
      expect(await service.setGeneralView('cocina', true)).toBeNull();
      expect(prisma.area.update).not.toHaveBeenCalled();
    });
  });
});
