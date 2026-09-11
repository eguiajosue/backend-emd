import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderHistoryDto } from './dto/create-order-history.dto';
import { UpdateOrderHistoryDto } from './dto/update-order-history.dto';
import { Prisma } from '@prisma/client';
import {
  buildPaginatedResult,
  PaginationQueryDto,
  resolvePagination,
} from 'src/common/dto/pagination-query.dto';

/**
 * Pedido embebido en el historial, acotado.
 *
 * Con `order: true` Prisma trae TODOS los escalares del pedido, incluida
 * `clientResourceFileData`: el archivo que mandó el cliente entero en base64
 * viajaba en cada item de `GET /order-histories`, visible para cualquier rol
 * operativo y multiplicando el peso de la respuesta.
 */
const ORDER_SELECT_FOR_HISTORY = {
  select: {
    id: true,
    clientId: true,
    clientNameOverride: true,
    userId: true,
    assignedUserId: true,
    statusId: true,
    area: true,
    description: true,
    creationDate: true,
    deliveryDate: true,
  },
} satisfies { select: Prisma.OrderSelect };

@Injectable()
export class OrderHistoryService {
  constructor(private prisma: PrismaService) {}

  async create(createOrderHistoryDto: CreateOrderHistoryDto) {
    try {
      const { orderId, previousStatusId, newStatusId, changeDate } =
        createOrderHistoryDto;

      const data: Prisma.OrderHistoryCreateInput = {
        changeDate: changeDate ? new Date(changeDate) : undefined,
        order: {
          connect: { id: orderId },
        },
        previousStatus: {
          connect: { id: previousStatusId },
        },
        newStatus: {
          connect: { id: newStatusId },
        },
      };

      const orderHistory = await this.prisma.orderHistory.create({
        data,
        include: {
          order: ORDER_SELECT_FOR_HISTORY,
          previousStatus: true,
          newStatus: true,
        },
      });
      return orderHistory;
    } catch (error) {
      if (error.code === 'P2003') {
        // Fallo en restricción de clave foránea
        throw new HttpException(
          'ID de orden o estado inválido',
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
      const include = {
        order: ORDER_SELECT_FOR_HISTORY,
        previousStatus: true,
        newStatus: true,
      };
      const { enabled, page, limit, skip } = resolvePagination(query);

      if (!enabled) {
        return await this.prisma.orderHistory.findMany({ include });
      }

      const [data, total] = await this.prisma.$transaction([
        this.prisma.orderHistory.findMany({
          include,
          skip,
          take: limit,
          orderBy: { changeDate: 'desc' },
        }),
        this.prisma.orderHistory.count(),
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
      const orderHistory = await this.prisma.orderHistory.findUnique({
        where: { id },
        include: {
          order: ORDER_SELECT_FOR_HISTORY,
          previousStatus: true,
          newStatus: true,
        },
      });
      if (!orderHistory) {
        throw new HttpException(
          'Historial de orden no encontrado',
          HttpStatus.NOT_FOUND,
        );
      }
      return orderHistory;
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw error;
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async update(id: number, updateOrderHistoryDto: UpdateOrderHistoryDto) {
    try {
      const { orderId, previousStatusId, newStatusId, changeDate } =
        updateOrderHistoryDto;

      const data: Prisma.OrderHistoryUpdateInput = {
        ...(changeDate && { changeDate: new Date(changeDate) }),
        ...(orderId && {
          order: {
            connect: { id: orderId },
          },
        }),
        ...(previousStatusId && {
          previousStatus: {
            connect: { id: previousStatusId },
          },
        }),
        ...(newStatusId && {
          newStatus: {
            connect: { id: newStatusId },
          },
        }),
      };

      const orderHistory = await this.prisma.orderHistory.update({
        where: { id },
        data,
        include: {
          order: ORDER_SELECT_FOR_HISTORY,
          previousStatus: true,
          newStatus: true,
        },
      });
      return orderHistory;
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException(
          'Historial de orden no encontrado',
          HttpStatus.NOT_FOUND,
        );
      }
      if (error.code === 'P2003') {
        // Fallo en restricción de clave foránea
        throw new HttpException(
          'ID de orden o estado inválido',
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
      await this.prisma.orderHistory.delete({
        where: { id },
      });
      return { message: 'Historial de orden eliminado correctamente' };
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException(
          'Historial de orden no encontrado',
          HttpStatus.NOT_FOUND,
        );
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }
}
