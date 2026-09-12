import { HttpException } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SupplierService', () => {
  let service: SupplierService;
  let prisma: {
    supplier: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      supplier: {
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
    service = new SupplierService(prisma as unknown as PrismaService);
  });

  it('crea un proveedor', async () => {
    await service.create({ name: 'Vidrios del Norte', location: 'local' });
    expect(prisma.supplier.create).toHaveBeenCalledWith({
      data: { name: 'Vidrios del Norte', location: 'local' },
    });
  });

  it('lanza 404 al actualizar un proveedor inexistente', async () => {
    prisma.supplier.findUnique.mockResolvedValue(null);
    await expect(service.update(999, { name: 'X' })).rejects.toThrow(
      HttpException,
    );
  });

  it('lanza 404 al borrar un proveedor inexistente', async () => {
    prisma.supplier.findUnique.mockResolvedValue(null);
    await expect(service.remove(999)).rejects.toThrow(HttpException);
  });

  it('borra un proveedor existente', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 1 });
    const result = await service.remove(1);
    expect(prisma.supplier.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(result).toEqual({ success: true });
  });
});
