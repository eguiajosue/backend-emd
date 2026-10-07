import { OrderProductPresetService } from './order-product-preset.service';
import { PrismaService } from '../prisma/prisma.service';

describe('OrderProductPresetService.findAll', () => {
  it('ordena los frecuentes por uso real (sin distinguir mayúsculas/acentos) y después por nombre', async () => {
    const prisma = {
      orderProductPreset: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, name: 'Gorra' },
          { id: 2, name: 'Figuras' },
          { id: 3, name: 'Lona' },
          { id: 4, name: 'Camión' },
        ]),
      },
      orderProduct: {
        groupBy: jest.fn().mockResolvedValue([
          { customName: 'Figuras', _count: { _all: 7 } },
          { customName: 'figuras ', _count: { _all: 2 } },
          { customName: 'Lona', _count: { _all: 3 } },
          { customName: 'Producto sin preset', _count: { _all: 50 } },
        ]),
      },
    };
    const service = new OrderProductPresetService(
      prisma as unknown as PrismaService,
    );
    const result = await service.findAll();
    expect(result.map((p) => [p.name, p.uses])).toEqual([
      ['Figuras', 9],
      ['Lona', 3],
      ['Camión', 0],
      ['Gorra', 0],
    ]);
    expect(prisma.orderProduct.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['customName'],
        where: { order: { creationDate: { gte: expect.any(Date) } } },
      }),
    );
  });
});

describe('OrderProductPresetService.findOrCreate', () => {
  const build = (existing: { id: number; name: string }[]) => {
    const rows = [...existing];
    const prisma: any = {
      orderProductPreset: {
        findMany: jest.fn().mockImplementation(async () => [...rows]),
        create: jest.fn().mockImplementation(async ({ data }) => {
          const row = { id: 99, ...data };
          rows.push(row);
          return row;
        }),
        findUnique: jest.fn(),
      },
      orderProduct: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    return {
      prisma,
      service: new OrderProductPresetService(prisma as PrismaService),
    };
  };

  it('crea el preset nuevo con el nombre sin espacios de más', async () => {
    const { prisma, service } = build([{ id: 1, name: 'Gorra' }]);
    const res = await service.findOrCreate('  Termo   grande ');
    expect(prisma.orderProductPreset.create).toHaveBeenCalledWith({
      data: { name: 'Termo grande' },
    });
    expect(res).toMatchObject({ id: 99, name: 'Termo grande' });
  });

  it('es idempotente e insensible a mayúsculas y acentos', async () => {
    const { prisma, service } = build([{ id: 5, name: 'Camión' }]);
    const res = await service.findOrCreate('  CAMION ');
    expect(prisma.orderProductPreset.create).not.toHaveBeenCalled();
    expect(res).toEqual({ id: 5, name: 'Camión', uses: 0 });
  });

  it('si otra petición lo creó a la vez (P2002) devuelve el existente', async () => {
    const { prisma, service } = build([]);
    prisma.orderProductPreset.create.mockRejectedValue({ code: 'P2002' });
    prisma.orderProductPreset.findUnique.mockResolvedValue({
      id: 7,
      name: 'Lona',
    });
    prisma.orderProductPreset.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 7, name: 'Lona' }]);
    await expect(service.findOrCreate('Lona')).resolves.toMatchObject({
      id: 7,
      name: 'Lona',
    });
  });
});
