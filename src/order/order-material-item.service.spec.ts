import { HttpException } from '@nestjs/common';
import { OrderMaterialItemService } from './order-material-item.service';
import { PrismaService } from '../prisma/prisma.service';

describe('OrderMaterialItemService - disponibilidad', () => {
  let service: OrderMaterialItemService;
  let prisma: {
    order: { findUnique: jest.Mock };
    orderMaterialItem: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      order: { findUnique: jest.fn().mockResolvedValue({ id: 7 }) },
      orderMaterialItem: {
        create: jest.fn((args: { data: unknown }) => ({
          id: 1,
          ...(args.data as object),
        })),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn((args: { data: unknown }) => ({
          id: 1,
          orderId: 7,
          ...(args.data as object),
        })),
        delete: jest.fn(),
      },
    };
    service = new OrderMaterialItemService(prisma as unknown as PrismaService);
  });

  it('crea una línea sin disponibilidad explícita (el default lo pone la base)', async () => {
    await service.create(
      7,
      { materialId: 1, quantity: 2, description: 'PVC 6mm' },
      5,
    );
    expect(prisma.orderMaterialItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ availability: undefined }),
      }),
    );
  });

  it('crea una línea marcada como agotada', async () => {
    await service.create(
      7,
      {
        materialId: 1,
        quantity: 2,
        description: 'PVC 6mm',
        availability: 'agotado' as never,
      },
      5,
    );
    expect(prisma.orderMaterialItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ availability: 'agotado' }),
      }),
    );
  });

  it('el select trae la unidad del material y la disponibilidad de la línea', async () => {
    await service.findByOrder(7);
    const call = prisma.orderMaterialItem.findMany.mock.calls[0][0];
    expect(call.select.availability).toBe(true);
    expect(call.select.material.select.unit).toEqual({
      select: { name: true },
    });
  });

  it('actualiza la disponibilidad de una línea existente', async () => {
    prisma.orderMaterialItem.findUnique.mockResolvedValue({
      id: 1,
      orderId: 7,
    });
    await service.update(7, 1, { availability: 'por_comprar' as never });
    expect(prisma.orderMaterialItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ availability: 'por_comprar' }),
      }),
    );
  });

  it('lanza 404 al actualizar una línea de otro pedido', async () => {
    prisma.orderMaterialItem.findUnique.mockResolvedValue({
      id: 1,
      orderId: 99,
    });
    await expect(
      service.update(7, 1, { availability: 'agotado' as never }),
    ).rejects.toThrow(HttpException);
  });
});
