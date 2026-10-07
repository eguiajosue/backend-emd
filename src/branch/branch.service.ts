import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { assertActiveBranchEmployee, branchOfUser } from './branch-access';
import {
  CreateBranchDto,
  CreateBranchEmployeeDto,
  UpdateBranchDto,
  UpdateBranchEmployeeDto,
} from './dto/branch.dto';

/**
 * Sucursales (ej. "Punto Madero") y sus empleados. La sucursal entra con una
 * cuenta compartida (rol `sucursal`, `User.branchId`); al levantar un pedido
 * elige quién lo hizo de esta lista, que administra admin desde Usuarios.
 */
@Injectable()
export class BranchService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.branch.findMany({
      orderBy: { name: 'asc' },
      include: { employees: { orderBy: { name: 'asc' } } },
    });
  }

  async create(dto: CreateBranchDto) {
    try {
      return await this.prisma.branch.create({ data: { name: dto.name } });
    } catch (error) {
      throw this.mapUnique(error, 'Ya existe una sucursal con ese nombre');
    }
  }

  async update(id: number, dto: UpdateBranchDto) {
    await this.getBranchOrThrow(id);
    try {
      return await this.prisma.branch.update({ where: { id }, data: dto });
    } catch (error) {
      throw this.mapUnique(error, 'Ya existe una sucursal con ese nombre');
    }
  }

  async findEmployees(branchId: number) {
    await this.getBranchOrThrow(branchId);
    return this.prisma.branchEmployee.findMany({
      where: { branchId },
      orderBy: { name: 'asc' },
    });
  }

  async createEmployee(branchId: number, dto: CreateBranchEmployeeDto) {
    await this.getBranchOrThrow(branchId);
    try {
      return await this.prisma.branchEmployee.create({
        data: { branchId, name: dto.name },
      });
    } catch (error) {
      throw this.mapUnique(error, 'Ya hay un empleado con ese nombre en la sucursal');
    }
  }

  async updateEmployee(
    branchId: number,
    employeeId: number,
    dto: UpdateBranchEmployeeDto,
  ) {
    const employee = await this.prisma.branchEmployee.findUnique({
      where: { id: employeeId },
    });
    if (!employee || employee.branchId !== branchId) {
      throw new HttpException('Empleado no encontrado', HttpStatus.NOT_FOUND);
    }
    try {
      return await this.prisma.branchEmployee.update({
        where: { id: employeeId },
        data: dto,
      });
    } catch (error) {
      throw this.mapUnique(error, 'Ya hay un empleado con ese nombre en la sucursal');
    }
  }

  /** Sucursal de la cuenta autenticada (rol `sucursal`). */
  async findMine(userId: number) {
    const branch = await this.branchOfUser(userId);
    return {
      id: branch.id,
      name: branch.name,
      active: branch.active,
      employees: await this.prisma.branchEmployee.findMany({
        where: { branchId: branch.id, active: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    };
  }

  branchOfUser(userId: number) {
    return branchOfUser(this.prisma, userId);
  }

  assertActiveEmployee(branchId: number, employeeId: number) {
    return assertActiveBranchEmployee(this.prisma, branchId, employeeId);
  }

  private async getBranchOrThrow(id: number) {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch) {
      throw new HttpException('Sucursal no encontrada', HttpStatus.NOT_FOUND);
    }
    return branch;
  }

  private mapUnique(error: unknown, message: string) {
    if ((error as { code?: string })?.code === 'P2002') {
      return new HttpException(message, HttpStatus.CONFLICT);
    }
    return error;
  }
}
