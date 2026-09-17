import { HttpException } from '@nestjs/common';
import { StatusService } from './status.service';
import { PrismaService } from '../prisma/prisma.service';

describe('StatusService', () => {
  let service: StatusService;
  let prisma: {
    status: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      status: {
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
    service = new StatusService(prisma as unknown as PrismaService);
  });

  // Regresión: `findAll`/`findOne` traían `include: { orders: true }`, que
  // multiplicaba el peso de `GET /status` por TODOS los pedidos del sistema
  // (incluido el archivo del cliente en base64 de cada uno). El frontend
  // sólo necesita id/name del catálogo, así que no debe pedirse ese include.
  it('lista los estados sin traer los pedidos anidados', async () => {
    await service.findAll();
    expect(prisma.status.findMany).toHaveBeenCalledWith();
    const [args] = prisma.status.findMany.mock.calls[0] as [unknown];
    expect(args).toBeUndefined();
  });

  it('busca un estado por id sin traer los pedidos anidados', async () => {
    prisma.status.findUnique.mockResolvedValue({ id: 1, name: 'Pendiente' });
    await service.findOne(1);
    expect(prisma.status.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('lanza 404 al buscar un estado inexistente', async () => {
    prisma.status.findUnique.mockResolvedValue(null);
    await expect(service.findOne(999)).rejects.toThrow(HttpException);
  });
});
