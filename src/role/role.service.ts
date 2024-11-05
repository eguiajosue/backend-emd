import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RoleService {
  constructor(private prisma: PrismaService) {}

  async create(createRoleDto: CreateRoleDto) {
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
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async findAll() {
    try {
      return await this.prisma.role.findMany();
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
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
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async update(id: number, updateRoleDto: UpdateRoleDto) {
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
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async remove(id: number) {
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
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
