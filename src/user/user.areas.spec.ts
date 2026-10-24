import { HttpStatus } from '@nestjs/common';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UserService: áreas de trabajo', () => {
  let service: UserService;
  let prisma: {
    user: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
    role: { findFirst: jest.Mock };
    area: { count: jest.Mock };
  };

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
        findUnique: jest.fn(),
      },
      role: { findFirst: jest.fn().mockResolvedValue(null) },
      area: { count: jest.fn() },
    };
    service = new UserService(prisma as unknown as PrismaService);
  });

  it('da de alta a alguien sólo con áreas (sin roles)', async () => {
    prisma.area.count.mockResolvedValue(2);

    await service.create({ ...base, areaIds: [3, 5] });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roles: { connect: [] },
          areas: { connect: [{ id: 3 }, { id: 5 }] },
        }),
      }),
    );
  });

  it('pide al menos un rol o un área', async () => {
    await expect(
      service.create({ ...base, roleIds: [], areaIds: [] }),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rechaza un área inexistente o desactivada', async () => {
    prisma.area.count.mockResolvedValue(1);

    await expect(
      service.create({ ...base, areaIds: [3, 99] }),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(prisma.area.count).toHaveBeenCalledWith({
      where: { id: { in: [3, 99] }, active: true },
    });
  });

  it('al editar reemplaza las áreas', async () => {
    prisma.area.count.mockResolvedValue(1);

    await service.update(1, {
      firstName: 'Ana',
      lastName: 'Ruiz',
      areaIds: [4],
    });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ areas: { set: [{ id: 4 }] } }),
      }),
    );
  });

  it('una edición no deja a nadie sin roles ni áreas', async () => {
    prisma.user.findUnique.mockResolvedValue({
      _count: { roles: 0, areas: 1 },
    });

    await expect(
      service.update(1, { firstName: 'Ana', lastName: 'Ruiz', areaIds: [] }),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
