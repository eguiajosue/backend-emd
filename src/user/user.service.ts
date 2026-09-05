import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Prisma } from '@prisma/client';
import * as bcryptjs from 'bcryptjs';

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
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async findAll() {
    try {
      return await this.prisma.user.findMany({
        include: {
          roles: true,
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async findOne(id: number) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
        include: {
          roles: true,
        },
      });
      if (!user) {
        throw new HttpException('Usuario no encontrado', HttpStatus.NOT_FOUND);
      }
      return user;
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw error;
      }
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
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
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
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
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
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
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
