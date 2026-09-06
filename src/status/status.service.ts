import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStatusDto } from './dto/create-status.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Injectable()
export class StatusService {
  constructor(private prisma: PrismaService) {}

  async create(createStatusDto: CreateStatusDto) {
    try {
      const status = await this.prisma.status.create({
        data: createStatusDto,
      });
      return status;
    } catch (error) {
      if (error.code === 'P2002') {
        // Violación de restricción única
        throw new HttpException(
          'El nombre del estado ya existe',
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
      return await this.prisma.status.findMany({
        include: {
          orders: true,
        },
      });
    } catch (error) {
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async findOne(id: number) {
    try {
      const status = await this.prisma.status.findUnique({
        where: { id },
        include: {
          orders: true,
        },
      });
      if (!status) {
        throw new HttpException('Estado no encontrado', HttpStatus.NOT_FOUND);
      }
      return status;
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw error;
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async update(id: number, updateStatusDto: UpdateStatusDto) {
    try {
      const status = await this.prisma.status.update({
        where: { id },
        data: updateStatusDto,
      });
      return status;
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException('Estado no encontrado', HttpStatus.NOT_FOUND);
      }
      if (error.code === 'P2002') {
        // Violación de restricción única
        throw new HttpException(
          'El nombre del estado ya existe',
          HttpStatus.BAD_REQUEST,
        );
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async remove(id: number) {
    try {
      await this.prisma.status.delete({
        where: { id },
      });
      return { message: 'Estado eliminado correctamente' };
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException('Estado no encontrado', HttpStatus.NOT_FOUND);
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }
}
