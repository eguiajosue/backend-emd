import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  MAX_TEMPLATES_PER_CLIENT,
  OrderTemplateService,
} from './order-template.service';
import { PrismaService } from '../prisma/prisma.service';

const dto = {
  name: 'Figuras de coroplast',
  requiresDesign: true,
  productionAreas: ['impresiones', 'impresiones', 'taller'],
  description: '  Figuras para eventos  ',
  products: [{ customName: 'Figuras', quantity: 12 }],
  materials: [
    {
      materialId: 5,
      quantity: 6,
      description: 'Vinil impreso sobre coroplast',
    },
  ],
};

describe('OrderTemplateService', () => {
  let service: OrderTemplateService;
  let prisma: {
    client: { findUnique: jest.Mock };
    orderTemplate: Record<string, jest.Mock>;
    orderTemplateProduct: { deleteMany: jest.Mock };
    orderTemplateMaterial: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      client: { findUnique: jest.fn().mockResolvedValue({ id: 3 }) },
      orderTemplate: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest
          .fn()
          .mockImplementation(({ data }) => ({ id: 1, ...data })),
        update: jest
          .fn()
          .mockImplementation(({ data }) => ({ id: 1, ...data })),
        delete: jest.fn().mockResolvedValue({ id: 1 }),
      },
      orderTemplateProduct: { deleteMany: jest.fn() },
      orderTemplateMaterial: { deleteMany: jest.fn() },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn) => fn(prisma));
    service = new OrderTemplateService(prisma as unknown as PrismaService);
  });

  it('lista las plantillas del cliente, las más usadas primero', async () => {
    await service.findByClient(3);
    expect(prisma.orderTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 3 },
        orderBy: [
          { useCount: 'desc' },
          { lastUsedAt: { sort: 'desc', nulls: 'last' } },
          { name: 'asc' },
        ],
      }),
    );
  });

  it('con un cliente inexistente responde 404', async () => {
    prisma.client.findUnique.mockResolvedValue(null);
    await expect(service.findByClient(99)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.create(99, dto, 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('crea la plantilla con productos y materiales en orden, sin áreas repetidas', async () => {
    await service.create(3, dto, 7);
    expect(prisma.orderTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          clientId: 3,
          name: 'Figuras de coroplast',
          requiresDesign: true,
          productionAreas: ['impresiones', 'taller'],
          description: 'Figuras para eventos',
          createdById: 7,
          products: {
            create: [{ position: 0, customName: 'Figuras', quantity: 12 }],
          },
          materials: {
            create: [
              {
                position: 0,
                materialId: 5,
                quantity: 6,
                description: 'Vinil impreso sobre coroplast',
                supplierId: null,
              },
            ],
          },
        },
      }),
    );
  });

  it('sin diseño exige al menos un área (mismo criterio que el alta)', async () => {
    await expect(
      service.create(
        3,
        { ...dto, requiresDesign: false, productionAreas: [] },
        1,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.orderTemplate.create).not.toHaveBeenCalled();
  });

  it('respeta el tope de plantillas por cliente', async () => {
    prisma.orderTemplate.count.mockResolvedValue(MAX_TEMPLATES_PER_CLIENT);
    await expect(service.create(3, dto, 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('un nombre repetido en el mismo cliente es 409', async () => {
    prisma.orderTemplate.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.create(3, dto, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('un material inexistente es 400', async () => {
    prisma.orderTemplate.create.mockRejectedValue({ code: 'P2003' });
    await expect(service.create(3, dto, 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('actualizar con productos reemplaza las líneas; sólo el nombre no las toca', async () => {
    prisma.orderTemplate.findUnique.mockResolvedValue({
      id: 1,
      requiresDesign: true,
      productionAreas: [],
    });

    await service.update(1, { name: 'Figuras' });
    expect(prisma.orderTemplateProduct.deleteMany).not.toHaveBeenCalled();
    expect(prisma.orderTemplateMaterial.deleteMany).not.toHaveBeenCalled();

    await service.update(1, {
      products: [{ customName: 'Figuras', quantity: 30 }],
      materials: [],
    });
    expect(prisma.orderTemplateProduct.deleteMany).toHaveBeenCalledWith({
      where: { templateId: 1 },
    });
    expect(prisma.orderTemplateMaterial.deleteMany).toHaveBeenCalledWith({
      where: { templateId: 1 },
    });
    expect(prisma.orderTemplate.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          products: {
            create: [{ position: 0, customName: 'Figuras', quantity: 30 }],
          },
          materials: { create: [] },
        }),
      }),
    );
  });

  it('pasar a "sin diseño" sin áreas se rechaza al actualizar', async () => {
    prisma.orderTemplate.findUnique.mockResolvedValue({
      id: 1,
      requiresDesign: true,
      productionAreas: [],
    });
    await expect(
      service.update(1, { requiresDesign: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('actualizar o borrar una plantilla inexistente es 404', async () => {
    prisma.orderTemplate.findUnique.mockResolvedValue(null);
    await expect(service.update(5, { name: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    prisma.orderTemplate.delete.mockRejectedValue({ code: 'P2025' });
    await expect(service.remove(5)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marcar como usada suma 1 y guarda la fecha', async () => {
    await service.markUsed(1);
    expect(prisma.orderTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { useCount: { increment: 1 }, lastUsedAt: expect.any(Date) },
      }),
    );
  });
});
