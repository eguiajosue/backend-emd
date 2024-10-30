import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}
  async create(createOrderDto: CreateOrderDto) {
    const { client_id, user_id, ...orderData } = createOrderDto;

    // Verificar existencia de cliente
    const clientExists = await this.prisma.clients.findUnique({
      where: { client_id },
    });
    if (!clientExists) {
      throw new BadRequestException('El cliente no existe');
    }

    // Verificar existencia de usuario
    const userExists = await this.prisma.users.findUnique({
      where: { user_id },
    });
    if (!userExists) {
      throw new BadRequestException('El usuario no existe');
    }

    // Crear la orden si ambos existen
    return this.prisma.orders.create({
      data: {
        ...orderData,
        client_id,
        user_id,
      },
    });
  }

  async findAll() {
    await this.prisma.orders.findMany();
  }

  async findOne(id: string) {
    try {
      const foundOrder = await this.prisma.orders.findUnique({
        where: {
          order_id: id,
        },
      });

      if (!foundOrder) {
        throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
      }
      return new HttpException(foundOrder, HttpStatus.FOUND);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  async update(id: string, updateOrderDto: UpdateOrderDto) {
    const foundOrder = await this.prisma.orders.findUnique({
      where: {
        order_id: id,
      },
    });

    if (!foundOrder) {
      throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    }
    return await this.prisma.orders.update({
      where: { order_id: id },
      data: { ...updateOrderDto },
    });
  }

  async remove(id: string) {
    const foundOrder = await this.prisma.orders.findUnique({
      where: { order_id: id },
    });
    if (!foundOrder) {
      throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    }
    return await this.prisma.orders.delete({
      where: { order_id: id },
    });
  }

  async updateStatus(id: string, status: OrderStatus) {
    const foundOrder = await this.prisma.orders.findUnique({
      where: {
        order_id: id,
      },
    });

    if (!foundOrder) {
      throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    }

    return await this.prisma.orders.update({
      where: {
        order_id: id,
      },
      data: { status },
    });
  }
}
