import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role } from '../common/enums/roles.enum';

/**
 * Roles que el código pide por nombre en `@Auth(...)`. Renombrar o borrar
 * uno deja a sus usuarios sin acceso, y crear o renombrar otro rol con uno de
 * estos nombres le daría sus permisos a quien lo tenga: sólo los crea el seed.
 */
const SYSTEM_ROLE_NAMES = new Set<string>(Object.values(Role));
const isSystemRoleName = (name: string | undefined) =>
  !!name && SYSTEM_ROLE_NAMES.has(name.trim().toLowerCase());

@Injectable()
export class RoleService {
  constructor(private prisma: PrismaService) {}

  private assertNameNotReserved(name: string | undefined) {
    if (isSystemRoleName(name)) {
      throw new HttpException(
        'Ese nombre está reservado para un rol del sistema',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async assertNotSystemRole(id: number) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      select: { name: true },
    });
    if (role && isSystemRoleName(role.name)) {
      throw new HttpException(
        'Los roles del sistema no se pueden renombrar ni eliminar',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async create(createRoleDto: CreateRoleDto) {
    this.assertNameNotReserved(createRoleDto.name);
    try {
      const role = await this.prisma.role.create({
        data: createRoleDto,
      });
      return role;
    } catch (error) {
      if (error.code === 'P2002') {
        // Violación de restricción única
        throw new HttpException(
          'El nombre del rol ya existe',
          HttpStatus.BAD_REQUEST,
        );
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async findAll() {
    try {
      return await this.prisma.role.findMany();
    } catch (error) {
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async findOne(id: number) {
    try {
      const role = await this.prisma.role.findFirst({
        where: { id },
      });
      if (!role) {
        throw new HttpException('Rol no encontrado', HttpStatus.NOT_FOUND);
      }
      return role;
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw error;
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async update(id: number, updateRoleDto: UpdateRoleDto) {
    this.assertNameNotReserved(updateRoleDto.name);
    await this.assertNotSystemRole(id);
    try {
      const role = await this.prisma.role.update({
        where: { id },
        data: updateRoleDto,
      });
      return role;
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException('Rol no encontrado', HttpStatus.NOT_FOUND);
      }
      if (error.code === 'P2002') {
        // Violación de restricción única
        throw new HttpException(
          'El nombre del rol ya existe',
          HttpStatus.BAD_REQUEST,
        );
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async remove(id: number) {
    await this.assertNotSystemRole(id);
    try {
      await this.prisma.role.delete({
        where: { id },
      });
      return { message: 'Rol eliminado correctamente' };
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException('Rol no encontrado', HttpStatus.NOT_FOUND);
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }
}
