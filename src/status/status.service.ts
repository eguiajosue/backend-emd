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
      throw new HttpException(
        'Error al crear el estado: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
      throw new HttpException(
        'Error al obtener los estados: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
      throw new HttpException(
        'Error al obtener el estado: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
      throw new HttpException(
        'Error al actualizar el estado: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
      throw new HttpException(
        'Error al eliminar el estado: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
