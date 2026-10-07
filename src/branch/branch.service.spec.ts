import { HttpStatus } from '@nestjs/common';
import { BranchService } from './branch.service';
import { assertActiveBranchEmployee, branchOfUser } from './branch-access';

describe('BranchService (admin CRUD de empleados)', () => {
  let prisma: any;
  let service: BranchService;

  beforeEach(() => {
    prisma = {
      branch: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      branchEmployee: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
      user: { findUnique: jest.fn() },
    };
    service = new BranchService(prisma);
  });

  it('crea un empleado en una sucursal existente', async () => {
    prisma.branch.findUnique.mockResolvedValue({ id: 1 });
    prisma.branchEmployee.create.mockResolvedValue({
      id: 5,
      name: 'Ana López',
    });
    await service.createEmployee(1, { name: 'Ana López' });
    expect(prisma.branchEmployee.create).toHaveBeenCalledWith({
      data: { branchId: 1, name: 'Ana López' },
    });
  });

  it('404 si la sucursal no existe', async () => {
    prisma.branch.findUnique.mockResolvedValue(null);
    await expect(
      service.createEmployee(9, { name: 'X' }),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('409 si el nombre del empleado ya existe en la sucursal', async () => {
    prisma.branch.findUnique.mockResolvedValue({ id: 1 });
    prisma.branchEmployee.create.mockRejectedValue({ code: 'P2002' });
    await expect(
      service.createEmployee(1, { name: 'Ana' }),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
  });

  it('renombra y desactiva un empleado de esa sucursal', async () => {
    prisma.branchEmployee.findUnique.mockResolvedValue({ id: 5, branchId: 1 });
    prisma.branchEmployee.update.mockResolvedValue({});
    await service.updateEmployee(1, 5, { name: 'Ana M.', active: false });
    expect(prisma.branchEmployee.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { name: 'Ana M.', active: false },
    });
  });

  it('no edita a un empleado de otra sucursal', async () => {
    prisma.branchEmployee.findUnique.mockResolvedValue({ id: 5, branchId: 2 });
    await expect(
      service.updateEmployee(1, 5, { active: false }),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
    expect(prisma.branchEmployee.update).not.toHaveBeenCalled();
  });

  it('GET me sólo devuelve empleados activos', async () => {
    prisma.user.findUnique.mockResolvedValue({
      branch: { id: 1, name: 'Punto Madero', active: true },
    });
    await service.findMine(7);
    expect(prisma.branchEmployee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { branchId: 1, active: true } }),
    );
  });

  describe('reglas de acceso', () => {
    it('403 sin sucursal o con sucursal inactiva', async () => {
      prisma.user.findUnique.mockResolvedValue({ branch: null });
      await expect(branchOfUser(prisma, 7)).rejects.toMatchObject({
        status: 403,
      });
      prisma.user.findUnique.mockResolvedValue({
        branch: { id: 1, active: false },
      });
      await expect(branchOfUser(prisma, 7)).rejects.toMatchObject({
        status: 403,
      });
    });

    it('empleado de otra sucursal o inactivo se rechaza', async () => {
      prisma.branchEmployee.findUnique.mockResolvedValue({
        id: 5,
        branchId: 2,
        active: true,
      });
      await expect(
        assertActiveBranchEmployee(prisma, 1, 5),
      ).rejects.toMatchObject({ status: 400 });
      prisma.branchEmployee.findUnique.mockResolvedValue({
        id: 5,
        branchId: 1,
        active: false,
      });
      await expect(
        assertActiveBranchEmployee(prisma, 1, 5),
      ).rejects.toMatchObject({ status: 400 });
      prisma.branchEmployee.findUnique.mockResolvedValue({
        id: 5,
        branchId: 1,
        active: true,
      });
      await expect(
        assertActiveBranchEmployee(prisma, 1, 5),
      ).resolves.toBeTruthy();
    });
  });
});
