import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createS3StorageForTests } from '../storage/testing/in-memory-object-store';
import { UserService } from './user.service';

describe('UserService.remove - archivos en el almacenamiento', () => {
  afterEach(() => jest.restoreAllMocks());

  it('borra del bucket los archivos de los pedidos del usuario, después de borrarlo', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { storage, store } = createS3StorageForTests();
    await store.put('cliente.pdf', Buffer.from('x'), 'application/pdf');
    await store.put('mk.png', Buffer.from('x'), 'image/png');
    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            clientResourceFileKey: 'cliente.pdf',
            designRevisions: [],
            mockups: [{ imageKey: 'mk.png' }],
          },
        ]),
        deleteMany: jest.fn(),
      },
      user: { delete: jest.fn() },
    };

    await new UserService(prisma as unknown as PrismaService, storage).remove(
      3,
    );

    expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({
      userId: 3,
    });
    expect(store.objects.size).toBe(0);
  });

  it('si el usuario no existe, no toca el bucket', async () => {
    const { storage, store } = createS3StorageForTests();
    await store.put('cliente.pdf', Buffer.from('x'), 'application/pdf');
    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            clientResourceFileKey: 'cliente.pdf',
            designRevisions: [],
            mockups: [],
          },
        ]),
        deleteMany: jest.fn(),
      },
      user: { delete: jest.fn().mockRejectedValue({ code: 'P2025' }) },
    };

    await expect(
      new UserService(prisma as unknown as PrismaService, storage).remove(3),
    ).rejects.toMatchObject({ status: 404 });
    expect(store.objects.size).toBe(1);
  });
});
