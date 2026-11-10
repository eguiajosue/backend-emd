import { HttpStatus } from '@nestjs/common';
import { RoleService } from './role.service';
import { PrismaService } from '../prisma/prisma.service';

describe('RoleService: roles del sistema', () => {
  let service: RoleService;
  let prisma: {
    role: {
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      findUnique: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      role: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        update: jest.fn().mockResolvedValue({ id: 1 }),
        delete: jest.fn().mockResolvedValue({ id: 1 }),
        findUnique: jest.fn().mockResolvedValue({ name: 'cortador' }),
      },
    };
    service = new RoleService(prisma as unknown as PrismaService);
  });

  it.each(['admin', 'Superuser', ' recepcion ', 'SUCURSAL'])(
    'no se puede crear un rol llamado "%s"',
    async (name) => {
      await expect(service.create({ name })).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
      expect(prisma.role.create).not.toHaveBeenCalled();
    },
  );

  it('no se puede renombrar un rol cualquiera a un nombre reservado', async () => {
    await expect(
      service.update(5, { name: 'superuser' }),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(prisma.role.update).not.toHaveBeenCalled();
  });

  it('no se puede renombrar ni borrar un rol del sistema', async () => {
    prisma.role.findUnique.mockResolvedValue({ name: 'admin' });

    await expect(service.update(1, { name: 'otro' })).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    await expect(service.remove(1)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    expect(prisma.role.update).not.toHaveBeenCalled();
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });

  it('un rol personalizado sí se crea, renombra y borra', async () => {
    await service.create({ name: 'cortador' });
    await service.update(5, { name: 'cortador de tela' });
    await service.remove(5);

    expect(prisma.role.create).toHaveBeenCalled();
    expect(prisma.role.update).toHaveBeenCalled();
    expect(prisma.role.delete).toHaveBeenCalled();
  });
});
