import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { Role } from 'src/common/enums/roles.enum';
import {
  isFullVisibilityRole,
  operationalRolesOf,
} from 'src/order/role-stage-mapping';

/**
 * Reglas de acceso de las sucursales, en funciones sueltas (sólo necesitan
 * Prisma) para que OrderService y OrderMockupService las usen sin sumar una
 * dependencia inyectada más.
 */

type PrismaLike = Pick<PrismaClient, 'user' | 'branchEmployee'>;

/** Selección liviana de sucursal/empleado para badges de pedidos. */
export const BRANCH_BADGE_SELECT = {
  select: { id: true, name: true },
} satisfies { select: Prisma.BranchSelect };

/**
 * Cuenta que SÓLO es de sucursal: sin un rol de la matriz que le dé más
 * visibilidad. Ve únicamente los pedidos de su sucursal.
 */
export function isBranchOnlyUser(roles: string[] | undefined): boolean {
  if (!roles?.includes(Role.SUCURSAL)) return false;
  return !isFullVisibilityRole(roles) && operationalRolesOf(roles).length === 0;
}

/**
 * Filtro Prisma "pedidos de la sucursal de este usuario" sin consultar antes
 * su `branchId`: la relación lo resuelve en la misma query. Si la cuenta no
 * tiene sucursal no coincide nada.
 */
export function branchOrdersWhere(userId: number): Prisma.OrderWhereInput {
  return { branch: { users: { some: { id: userId } } } };
}

/**
 * Sucursal de la cuenta. 403 si no tiene sucursal asignada o está inactiva:
 * sin eso no puede levantar pedidos.
 */
export async function branchOfUser(prisma: PrismaLike, userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { branch: true },
  });
  if (!user?.branch) {
    throw new HttpException(
      'La cuenta no tiene una sucursal asignada',
      HttpStatus.FORBIDDEN,
    );
  }
  if (!user.branch.active) {
    throw new HttpException('La sucursal está inactiva', HttpStatus.FORBIDDEN);
  }
  return user.branch;
}

/** El empleado existe, es de esa sucursal y está activo. */
export async function assertActiveBranchEmployee(
  prisma: PrismaLike,
  branchId: number,
  employeeId: number,
) {
  const employee = await prisma.branchEmployee.findUnique({
    where: { id: employeeId },
  });
  if (!employee || employee.branchId !== branchId) {
    throw new HttpException(
      'El empleado no pertenece a la sucursal',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (!employee.active) {
    throw new HttpException('El empleado está inactivo', HttpStatus.BAD_REQUEST);
  }
  return employee;
}
