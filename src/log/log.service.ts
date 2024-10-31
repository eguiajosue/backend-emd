import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLogDto } from './dto/create-log.dto';

@Injectable()
export class LogService {
  constructor(private prisma: PrismaService) {}

  async create(createLogDto: CreateLogDto) {
    const { userId, action } = createLogDto;

    try {
      const log = await this.prisma.log.create({
        data: {
          user: { connect: { id: userId } },
          action,
        },
      });
      return log;
    } catch (error) {
      if (error.code === 'P2003') {
        // Fallo en restricción de clave foránea
        throw new HttpException(
          'ID de usuario inválido',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        'Error al crear el registro en el log: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findAll() {
    try {
      return await this.prisma.log.findMany({
        include: {
          user: true, // Incluye los detalles del usuario
        },
        orderBy: {
          logDate: 'desc',
        },
      });
    } catch (error) {
      throw new HttpException(
        'Error al obtener los registros del log: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
