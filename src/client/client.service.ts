import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import {
  buildPaginatedResult,
  PaginationQueryDto,
  resolvePagination,
} from 'src/common/dto/pagination-query.dto';

@Injectable()
export class ClientService {
  constructor(private prisma: PrismaService) {}

  async create(createClientDto: CreateClientDto) {
    try {
      const client = await this.prisma.client.create({
        data: createClientDto,
      });
      return client;
    } catch (error) {
      if (error.code === 'P2003') {
        // Fallo en restricción de clave foránea
        throw new HttpException(
          'ID de empresa inválido',
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
      const include = { company: true };
      const { enabled, page, limit, skip } = resolvePagination(query);

      if (!enabled) {
        return await this.prisma.client.findMany({ include });
      }

      const [data, total] = await this.prisma.$transaction([
        this.prisma.client.findMany({
          include,
          skip,
          take: limit,
          orderBy: { id: 'asc' },
        }),
        this.prisma.client.count(),
      ]);

      return buildPaginatedResult(data, total, page, limit);
    } catch (error) {
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async findOne(id: number) {
    try {
      const client = await this.prisma.client.findUnique({
        where: { id },
        include: {
          company: true,
        },
      });
      if (!client) {
        throw new HttpException('Cliente no encontrado', HttpStatus.NOT_FOUND);
      }
      return client;
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw error;
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async update(id: number, updateClientDto: UpdateClientDto) {
    try {
      const client = await this.prisma.client.update({
        where: { id },
        data: updateClientDto,
      });
      return client;
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException('Cliente no encontrado', HttpStatus.NOT_FOUND);
      }
      if (error.code === 'P2003') {
        // Fallo en restricción de clave foránea
        throw new HttpException(
          'ID de empresa inválido',
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
      await this.prisma.client.delete({
        where: { id },
      });
      return { message: 'Cliente eliminado correctamente' };
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException('Cliente no encontrado', HttpStatus.NOT_FOUND);
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }
}
