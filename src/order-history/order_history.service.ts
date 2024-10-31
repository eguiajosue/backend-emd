import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderHistoryDto } from './dto/create-order_history.dto';

@Injectable()
export class OrderHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createOrderHistoryDto: CreateOrderHistoryDto) {
    try {
      return await this.prisma.order_History.create({
        data: createOrderHistoryDto,
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async findOne(orderId: string) {
    try {
      return await this.prisma.order_History.findMany({
        where: { order_id: orderId },
        orderBy: { change_date: 'desc' },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async remove(orderId: string) {
    try {
      return await this.prisma.order_History.deleteMany({
        where: { order_id: orderId },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
