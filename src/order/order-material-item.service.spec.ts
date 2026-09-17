import { HttpException } from '@nestjs/common';
import { OrderMaterialItemService } from './order-material-item.service';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarEventService } from '../calendar-event/calendar-event.service';

describe('OrderMaterialItemService', () => {
  let service: OrderMaterialItemService;
  let ensureMaterialsPurchaseEvent: jest.Mock;
  let prisma: {
    order: { findUnique: jest.Mock };
    material: { findUnique: jest.Mock };
    orderMaterialItem: {
      create: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      order: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 7, deliveryDate: new Date('2026-10-01') }),
      },
      material: {
        findUnique: jest.fn().mockResolvedValue({ suggestedPrice: 150 }),
      },
      orderMaterialItem: {
        create: jest.fn((args: { data: unknown }) => ({
          id: 1,
          ...(args.data as object),
        })),
        count: jest.fn().mockResolvedValue(0),
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
    ensureMaterialsPurchaseEvent = jest.fn().mockResolvedValue(undefined);
    service = new OrderMaterialItemService(
      prisma as unknown as PrismaService,
      { ensureMaterialsPurchaseEvent } as unknown as CalendarEventService,
    );
  });

  it('copia el precio sugerido del material al crear la línea', async () => {
    await service.create(
      7,
      { materialId: 1, quantity: 2, description: 'PVC 6mm' },
      5,
    );
    expect(prisma.orderMaterialItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ price: 150 }),
      }),
    );
  });

  it('usa 0 si el material no tiene precio sugerido cargado', async () => {
    prisma.material.findUnique.mockResolvedValue({ suggestedPrice: null });
    await service.create(
      7,
      { materialId: 1, quantity: 2, description: 'PVC 6mm' },
      5,
    );
    expect(prisma.orderMaterialItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ price: 0 }),
      }),
    );
  });

  it('el select trae la unidad del material, el precio y el checklist de compra', async () => {
    await service.findByOrder(7);
    const call = prisma.orderMaterialItem.findMany.mock.calls[0][0];
    expect(call.select.price).toBe(true);
    expect(call.select.purchased).toBe(true);
    expect(call.select.material.select.unit).toEqual({
      select: { name: true },
    });
  });

  it('al agregar el primer material con el pedido ya con fecha de entrega, crea el aviso de compra', async () => {
    prisma.orderMaterialItem.count.mockResolvedValue(0);
    await service.create(
      7,
      { materialId: 1, quantity: 2, description: 'PVC 6mm' },
      5,
    );
    expect(ensureMaterialsPurchaseEvent).toHaveBeenCalledWith(
      7,
      new Date('2026-10-01'),
      5,
    );
  });

  it('no crea el aviso si ya había otros materiales cargados', async () => {
    prisma.orderMaterialItem.count.mockResolvedValue(2);
    await service.create(
      7,
      { materialId: 1, quantity: 2, description: 'PVC 6mm' },
      5,
    );
    expect(ensureMaterialsPurchaseEvent).not.toHaveBeenCalled();
  });

  it('no crea el aviso si el pedido todavía no tiene fecha de entrega', async () => {
    prisma.order.findUnique.mockResolvedValue({ id: 7, deliveryDate: null });
    prisma.orderMaterialItem.count.mockResolvedValue(0);
    await service.create(
      7,
      { materialId: 1, quantity: 2, description: 'PVC 6mm' },
      5,
    );
    expect(ensureMaterialsPurchaseEvent).not.toHaveBeenCalled();
  });

  it('marca una línea como comprada', async () => {
    prisma.orderMaterialItem.findUnique.mockResolvedValue({
      id: 1,
      orderId: 7,
    });
    await service.update(7, 1, { purchased: true });
    expect(prisma.orderMaterialItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ purchased: true }),
      }),
    );
  });

  it('lanza 404 al actualizar una línea de otro pedido', async () => {
    prisma.orderMaterialItem.findUnique.mockResolvedValue({
      id: 1,
      orderId: 99,
    });
    await expect(service.update(7, 1, { purchased: true })).rejects.toThrow(
      HttpException,
    );
  });
});
