import { HttpStatus } from '@nestjs/common';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UserService: sólo un superusuario administra superusuarios', () => {
  let service: UserService;
  let prisma: {
    user: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      delete: jest.Mock;
    };
    role: { findFirst: jest.Mock };
    order: { count: jest.Mock };
    area: { count: jest.Mock };
  };

  // Hay un rol superuser (id 9); `assertBranchForRoles` busca por 'sucursal'.
  const superuserRoleExists = () =>
    prisma.role.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.name?.equals === 'superuser' ? { id: 9 } : null),
    );

  const admin = { roles: ['admin'] };
  const superuser = { roles: ['superuser'] };
  const base = {
    firstName: 'Ana',
    lastName: 'Ruiz',
    username: 'aruiz',
    password: 'Secreta123',
  };

  beforeEach(() => {
    prisma = {
      user: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        update: jest.fn().mockResolvedValue({ id: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          firstName: 'Ana',
          lastName: 'Ruiz',
          branchId: null,
          roles: [],
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        delete: jest.fn().mockResolvedValue({ id: 7 }),
      },
      // Por defecto ninguno de los roles pedidos es superuser.
      role: { findFirst: jest.fn().mockResolvedValue(null) },
      order: { count: jest.fn().mockResolvedValue(0) },
      area: { count: jest.fn().mockResolvedValue(0) },
    };
    service = new UserService(prisma as unknown as PrismaService);
  });

  it('un admin no puede crear una cuenta con rol superuser', async () => {
    superuserRoleExists();

    await expect(
      service.create({ ...base, roleIds: [9] }, admin),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('un admin no puede darse el rol superuser a sí mismo', async () => {
    superuserRoleExists();

    await expect(
      service.update(7, { roleIds: [9] }, admin),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('un admin no puede cambiarle la contraseña a un superusuario', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 3 });

    await expect(
      service.update(3, { password: 'Nueva12345' }, admin),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('un admin no puede eliminar a un superusuario', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 3 });

    await expect(service.remove(3, admin)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('un admin sí administra usuarios que no son superuser', async () => {
    await service.create({ ...base, roleIds: [2] }, admin);
    await service.update(7, { firstName: 'Beatriz', lastName: 'Ruiz' }, admin);
    expect(prisma.user.create).toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('un superuser sí puede asignar el rol y administrar superusuarios', async () => {
    superuserRoleExists();
    prisma.user.findFirst.mockResolvedValue({ id: 3 });

    await service.create({ ...base, roleIds: [9] }, superuser);
    await service.update(3, { password: 'Nueva12345' }, superuser);

    expect(prisma.user.create).toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('sin actor (seed, uso interno) no se restringe', async () => {
    superuserRoleExists();

    await service.create({ ...base, roleIds: [9] });

    expect(prisma.user.create).toHaveBeenCalled();
  });
});
