import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderHistoryDto } from './dto/create-order-history.dto';
import { UpdateOrderHistoryDto } from './dto/update-order-history.dto';
import { Prisma } from '@prisma/client';

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
          order: true,
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
      throw new HttpException(
        'Error al crear el historial de la orden: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findAll() {
    try {
      return await this.prisma.orderHistory.findMany({
        include: {
          order: true,
          previousStatus: true,
          newStatus: true,
        },
      });
    } catch (error) {
      throw new HttpException(
        'Error al obtener los historiales de órdenes: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findOne(id: number) {
    try {
      const orderHistory = await this.prisma.orderHistory.findUnique({
        where: { id },
        include: {
          order: true,
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
      throw new HttpException(
        'Error al obtener el historial de la orden: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
          order: true,
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
      throw new HttpException(
        'Error al actualizar el historial de la orden: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
      throw new HttpException(
        'Error al eliminar el historial de la orden: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
