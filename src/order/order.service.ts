import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class OrderService {
  constructor(private prisma: PrismaService) {}

  async create(createOrderDto: CreateOrderDto) {
    try {
      const {
        clientId,
        userId,
        statusId,
        description,
        deliveryDate,
        orderProducts,
      } = createOrderDto;

      const data: Prisma.OrderCreateInput = {
        description,
        creationDate: new Date(),
        deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
        client: {
          connect: { id: clientId },
        },
        user: {
          connect: { id: userId },
        },
        status: {
          connect: { id: statusId },
        },
        orderProducts: orderProducts
          ? {
              create: orderProducts.map((op) => ({
                quantity: op.quantity,
                product: {
                  connect: { id: op.productId },
                },
              })),
            }
          : undefined,
      };

      const order = await this.prisma.order.create({
        data,
        include: {
          client: true,
          user: true,
          status: true,
          orderProducts: {
            include: {
              product: true,
            },
          },
        },
      });
      return order;
    } catch (error) {
      if (error.code === 'P2003') {
        // Fallo en restricción de clave foránea
        throw new HttpException(
          'ID de cliente, usuario, estado o producto inválido',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        'Error al crear la orden: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findAll() {
    try {
      return await this.prisma.order.findMany({
        include: {
          client: true,
          user: true,
          status: true,
          orderProducts: {
            include: {
              product: true,
            },
          },
        },
      });
    } catch (error) {
      throw new HttpException(
        'Error al obtener las órdenes: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findOne(id: number) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id },
        include: {
          client: true,
          user: true,
          status: true,
          orderProducts: {
            include: {
              product: true,
            },
          },
        },
      });
      if (!order) {
        throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);
      }
      return order;
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw error;
      }
      throw new HttpException(
        'Error al obtener la orden: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async update(id: number, updateOrderDto: UpdateOrderDto) {
    try {
      const {
        clientId,
        userId,
        statusId,
        description,
        deliveryDate,
        orderProducts,
      } = updateOrderDto;

      const data: Prisma.OrderUpdateInput = {
        ...(description && { description }),
        ...(deliveryDate && { deliveryDate: new Date(deliveryDate) }),
        ...(clientId && {
          client: {
            connect: { id: clientId },
          },
        }),
        ...(userId && {
          user: {
            connect: { id: userId },
          },
        }),
        ...(statusId && {
          status: {
            connect: { id: statusId },
          },
        }),
        ...(orderProducts && {
          orderProducts: {
            deleteMany: {}, // Elimina los productos existentes en la orden
            create: orderProducts.map((op) => ({
              quantity: op.quantity,
              product: {
                connect: { id: op.productId },
              },
            })),
          },
        }),
      };

      const order = await this.prisma.order.update({
        where: { id },
        data,
        include: {
          client: true,
          user: true,
          status: true,
          orderProducts: {
            include: {
              product: true,
            },
          },
        },
      });
      return order;
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);
      }
      if (error.code === 'P2003') {
        // Fallo en restricción de clave foránea
        throw new HttpException(
          'ID de cliente, usuario, estado o producto inválido',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        'Error al actualizar la orden: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async remove(id: number) {
    try {
      await this.prisma.order.delete({
        where: { id },
      });
      return { message: 'Orden eliminada correctamente' };
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Error al eliminar la orden: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
