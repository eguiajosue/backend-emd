import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderProductDto } from './dto/create-order-product.dto';
import { UpdateOrderProductDto } from './dto/update-order-product.dto';

@Injectable()
export class OrderProductService {
  constructor(private prisma: PrismaService) {}

  async create(createOrderProductDto: CreateOrderProductDto) {
    const { orderId, productId, quantity } = createOrderProductDto;

    return this.prisma.$transaction(async (prisma) => {
      // Obtener el producto y verificar la cantidad en inventario
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw new HttpException('Producto no encontrado', HttpStatus.NOT_FOUND);
      }

      if (product.quantity < quantity) {
        throw new HttpException(
          'Cantidad insuficiente en inventario',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Crear la relación OrderProduct
      const orderProduct = await prisma.orderProduct.create({
        data: {
          order: { connect: { id: orderId } },
          product: { connect: { id: productId } },
          quantity,
        },
      });

      // Restar la cantidad solicitada del inventario del producto
      await prisma.product.update({
        where: { id: productId },
        data: { quantity: product.quantity - quantity },
      });

      return orderProduct;
    });
  }

  async findAll() {
    try {
      return await this.prisma.orderProduct.findMany({
        include: {
          order: true,
          product: true,
        },
      });
    } catch (error) {
      throw new HttpException(
        'Error al obtener los productos del pedido: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findOne(orderId: string, productId: number) {
    try {
      const orderProduct = await this.prisma.orderProduct.findUnique({
        where: {
          orderId_productId: { orderId, productId },
        },
        include: {
          order: true,
          product: true,
        },
      });
      if (!orderProduct) {
        throw new HttpException(
          'Producto del pedido no encontrado',
          HttpStatus.NOT_FOUND,
        );
      }
      return orderProduct;
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw error;
      }
      throw new HttpException(
        'Error al obtener el producto del pedido: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async update(
    orderId: string,
    productId: number,
    updateOrderProductDto: UpdateOrderProductDto,
  ) {
    const { quantity } = updateOrderProductDto;

    return this.prisma.$transaction(async (prisma) => {
      const orderProduct = await prisma.orderProduct.findUnique({
        where: { orderId_productId: { orderId, productId } },
        include: { product: true },
      });

      if (!orderProduct) {
        throw new HttpException(
          'Producto del pedido no encontrado',
          HttpStatus.NOT_FOUND,
        );
      }

      const difference = quantity - orderProduct.quantity;

      if (orderProduct.product.quantity < difference) {
        throw new HttpException(
          'Cantidad insuficiente en inventario para actualizar',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Actualizar el pedido-producto
      const updatedOrderProduct = await prisma.orderProduct.update({
        where: { orderId_productId: { orderId, productId } },
        data: { quantity },
      });

      // Actualizar el inventario
      await prisma.product.update({
        where: { id: productId },
        data: { quantity: orderProduct.product.quantity - difference },
      });

      return updatedOrderProduct;
    });
  }

  async remove(orderId: string, productId: number) {
    return this.prisma.$transaction(async (prisma) => {
      const orderProduct = await prisma.orderProduct.findUnique({
        where: { orderId_productId: { orderId, productId } },
        include: { product: true },
      });

      if (!orderProduct) {
        throw new HttpException(
          'Producto del pedido no encontrado',
          HttpStatus.NOT_FOUND,
        );
      }

      // Revertir la cantidad al eliminar el pedido-producto
      await prisma.product.update({
        where: { id: productId },
        data: {
          quantity: orderProduct.product.quantity + orderProduct.quantity,
        },
      });

      return prisma.orderProduct.delete({
        where: { orderId_productId: { orderId, productId } },
      });
    });
  }
}
