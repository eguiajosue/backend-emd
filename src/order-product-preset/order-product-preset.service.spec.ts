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
