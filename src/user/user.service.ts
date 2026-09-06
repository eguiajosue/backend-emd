import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { Prisma } from '@prisma/client';
import * as bcryptjs from 'bcryptjs';

/**
 * Campos que se devuelven al cliente. Excluye `password` explícitamente:
 * ningún endpoint debe filtrar el hash de la contraseña.
 */
const USER_SAFE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  roles: true,
  isSharedAccount: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async usernameExists(username: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { username },
    });
    return !!user;
  }

  async create(createUserDto: CreateUserDto) {
    try {
      const { roleIds, password, ...rest } = createUserDto;
      const hashedPassword = await bcryptjs.hash(password, 10);

      const data: Prisma.UserCreateInput = {
        ...rest,
        password: hashedPassword,
        roles: {
          connect: roleIds.map((id) => ({ id })),
        },
      };

      const user = await this.prisma.user.create({
        data,
        select: USER_SAFE_SELECT,
      });
      return user;
    } catch (error) {
      if (error.code === 'P2002') {
        // Violación de restricción única (por ejemplo, username ya existe)
        throw new HttpException(
          'El nombre de usuario ya existe',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (error.code === 'P2003') {
        // Fallo en restricción de clave foránea (roleId inválido)
        throw new HttpException('ID de rol inválido', HttpStatus.BAD_REQUEST);
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async findAll() {
    try {
      return await this.prisma.user.findMany({
        select: USER_SAFE_SELECT,
        orderBy: { id: 'asc' },
      });
    } catch (error) {
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async findOne(id: number) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
        select: USER_SAFE_SELECT,
      });
      if (!user) {
        throw new HttpException('Usuario no encontrado', HttpStatus.NOT_FOUND);
      }
      return user;
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw error;
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async findOneByUsername(username: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { username },
        include: {
          roles: true,
        },
      });
      return user || null;
    } catch (error) {
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    try {
      const { roleIds, password, firstName, lastName, ...rest } = updateUserDto;

      // Obtiene el usuario actual si firstName o lastName no están definidos
      let currentUser;
      if (!firstName || !lastName) {
        currentUser = await this.prisma.user.findUnique({ where: { id } });
        if (!currentUser) {
          throw new HttpException(
            'Usuario no encontrado',
            HttpStatus.NOT_FOUND,
          );
        }
      }

      let hashedPassword;
      if (password) {
        hashedPassword = await bcryptjs.hash(password, 10);
      }

      const data: Prisma.UserUpdateInput = {
        ...rest,
        firstName: firstName ?? currentUser.firstName,
        lastName: lastName ?? currentUser.lastName,
        ...(hashedPassword && { password: hashedPassword }),
        ...(roleIds && {
          roles: {
            set: roleIds.map((id) => ({ id })),
          },
        }),
      };

      const user = await this.prisma.user.update({
        where: { id },
        data,
        select: USER_SAFE_SELECT,
      });
      return user;
    } catch (error) {
      if (error.code === 'P2025') {
        throw new HttpException('Usuario no encontrado', HttpStatus.NOT_FOUND);
      }
      if (error.code === 'P2002') {
        throw new HttpException(
          'El nombre de usuario ya existe',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (error.code === 'P2003') {
        throw new HttpException('ID de rol inválido', HttpStatus.BAD_REQUEST);
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async getPreferences(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        themePreference: true,
        accentColor: true,
        languagePreference: true,
      },
    });
    if (!user) {
      throw new HttpException('Usuario no encontrado', HttpStatus.NOT_FOUND);
    }
    return user;
  }

  async updatePreferences(
    id: number,
    updateUserPreferencesDto: UpdateUserPreferencesDto,
  ) {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: { ...updateUserPreferencesDto },
        select: {
          themePreference: true,
          accentColor: true,
          languagePreference: true,
        },
      });
    } catch (error) {
      if (error.code === 'P2025') {
        throw new HttpException('Usuario no encontrado', HttpStatus.NOT_FOUND);
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async remove(id: number) {
    try {
      // Primero, elimina las órdenes asociadas al usuario
      await this.prisma.order.deleteMany({
        where: { userId: id },
      });

      // Luego, elimina el usuario
      await this.prisma.user.delete({
        where: { id },
      });

      return { message: 'Usuario eliminado correctamente' };
    } catch (error) {
      if (error.code === 'P2025') {
        throw new HttpException('Usuario no encontrado', HttpStatus.NOT_FOUND);
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }
}
