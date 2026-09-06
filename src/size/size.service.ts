import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSizeDto } from './dto/create-size.dto';
import { UpdateSizeDto } from './dto/update-size.dto';

@Injectable()
export class SizeService {
  constructor(private prisma: PrismaService) {}

  async create(createSizeDto: CreateSizeDto) {
    try {
      const size = await this.prisma.size.create({
        data: createSizeDto,
      });
      return size;
    } catch (error) {
      if (error.code === 'P2002') {
        // Violación de restricción única
        throw new HttpException(
          'El nombre del tamaño ya existe',
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
      return await this.prisma.size.findMany({
        include: {
          products: true,
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
      const size = await this.prisma.size.findUnique({
        where: { id },
        include: {
          products: true,
        },
      });
      if (!size) {
        throw new HttpException('Tamaño no encontrado', HttpStatus.NOT_FOUND);
      }
      return size;
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw error;
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async update(id: number, updateSizeDto: UpdateSizeDto) {
    try {
      const size = await this.prisma.size.update({
        where: { id },
        data: updateSizeDto,
      });
      return size;
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException('Tamaño no encontrado', HttpStatus.NOT_FOUND);
      }
      if (error.code === 'P2002') {
        // Violación de restricción única
        throw new HttpException(
          'El nombre del tamaño ya existe',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        'Error al actualizar el tamaño',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async remove(id: number) {
    try {
      await this.prisma.size.delete({
        where: { id },
      });
      return { message: 'Tamaño eliminado correctamente' };
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException('Tamaño no encontrado', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Error al eliminar el tamaño',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
