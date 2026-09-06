import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLogDto } from './dto/create-log.dto';
import {
  buildPaginatedResult,
  PaginationQueryDto,
  resolvePagination,
} from 'src/common/dto/pagination-query.dto';

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
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  /** Paginación OPT-IN (ver PaginationQueryDto). */
  async findAll(query?: PaginationQueryDto) {
    try {
      // No se incluye `password`: sólo los datos del usuario que se muestran.
      const include = {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
          },
        },
      };
      const orderBy = { logDate: 'desc' as const };
      const { enabled, page, limit, skip } = resolvePagination(query);

      if (!enabled) {
        return await this.prisma.log.findMany({ include, orderBy });
      }

      const [data, total] = await this.prisma.$transaction([
        this.prisma.log.findMany({ include, orderBy, skip, take: limit }),
        this.prisma.log.count(),
      ]);

      return buildPaginatedResult(data, total, page, limit);
    } catch (error) {
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }
}
