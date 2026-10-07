/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createS3StorageForTests } from '../storage/testing/in-memory-object-store';
import { UserService } from './user.service';

/** Prisma mínimo: usuario ordinario (sin sucursal) y transacción interactiva. */
function makePrisma(overrides: Record<string, any> = {}) {
  const prisma: any = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ branchId: null, roles: [{ name: 'taller' }] }),
      delete: jest.fn(),
    },
    order: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    ...overrides,
  };
  return prisma;
}

describe('UserService.remove - archivos en el almacenamiento', () => {
  afterEach(() => jest.restoreAllMocks());

  it('borra del bucket los archivos de los pedidos del usuario, después de borrarlo', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { storage, store } = createS3StorageForTests();
    await store.put('cliente.pdf', Buffer.from('x'), 'application/pdf');
    await store.put('mk.png', Buffer.from('x'), 'image/png');
    const prisma = makePrisma();
    prisma.order.findMany.mockResolvedValue([
      {
        clientResourceFileKey: 'cliente.pdf',
        designRevisions: [],
        mockups: [{ imageKey: 'mk.png' }],
      },
    ]);

    await new UserService(prisma as unknown as PrismaService, storage).remove(
      3,
    );

    expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({
      userId: 3,
    });
    expect(prisma.order.deleteMany).toHaveBeenCalledWith({
      where: { userId: 3 },
    });
    expect(store.objects.size).toBe(0);
  });

  it('si falla el borrado del usuario, la transacción revierte y los archivos NO se borran', async () => {
    const { storage, store } = createS3StorageForTests();
    await store.put('cliente.pdf', Buffer.from('x'), 'application/pdf');
    const prisma = makePrisma();
    prisma.order.findMany.mockResolvedValue([
      {
        clientResourceFileKey: 'cliente.pdf',
        designRevisions: [],
        mockups: [],
      },
    ]);
    prisma.user.delete.mockRejectedValue({ code: 'P2025' });

    await expect(
      new UserService(prisma as unknown as PrismaService, storage).remove(3),
    ).rejects.toMatchObject({ status: 404 });
    // Todo corrió dentro de la misma transacción (que Prisma revierte)...
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // ...así que los pedidos siguen existiendo y sus archivos también.
    expect(store.objects.size).toBe(1);
  });
});

describe('UserService.remove - cuentas de sucursal (compartidas)', () => {
  const expect409 = async (prisma: any) => {
    const { storage } = createS3StorageForTests();
    await expect(
      new UserService(prisma as unknown as PrismaService, storage).remove(7),
    ).rejects.toMatchObject({ status: 409 });
    expect(prisma.order.deleteMany).not.toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
  };

  it('rechaza (409) borrar una cuenta con el rol sucursal', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      branchId: null,
      roles: [{ name: 'sucursal' }],
    });
    await expect409(prisma);
  });

  it('rechaza (409) borrar una cuenta ligada a una sucursal', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ branchId: 1, roles: [] });
    await expect409(prisma);
  });

  it('rechaza (409) si la cuenta levantó pedidos de una sucursal', async () => {
    const prisma = makePrisma();
    prisma.order.count.mockResolvedValue(12);
    await expect409(prisma);
  });

  it('dice que se renombre o se cambie la contraseña', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ branchId: 1, roles: [] });
    const { storage } = createS3StorageForTests();
    await expect(
      new UserService(prisma as unknown as PrismaService, storage).remove(7),
    ).rejects.toThrow(/nombre de usuario o su contraseña/);
  });

  it('un usuario inexistente da 404', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    const { storage } = createS3StorageForTests();
    await expect(
      new UserService(prisma as unknown as PrismaService, storage).remove(7),
    ).rejects.toMatchObject({ status: 404 });
  });
});
