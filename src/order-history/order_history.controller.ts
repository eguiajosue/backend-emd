import { Controller, Post, Get, Param, Body, Delete } from '@nestjs/common';
import { OrderHistoryService } from './order_history.service';
import { CreateOrderHistoryDto } from './dto/create-order_history.dto';

@Controller('order-history')
export class OrderHistoryController {
  constructor(private readonly orderHistoryService: OrderHistoryService) {}
  @Post()
  async createHistory(@Body() createOrderHistoryDto: CreateOrderHistoryDto) {
    return this.orderHistoryService.create(createOrderHistoryDto);
  }

  @Get(':orderId')
  async getHistoryByOrderId(@Param('orderId') orderId: string) {
    return this.orderHistoryService.findOne(orderId);
  }

  @Delete(':orderId')
  async deleteHistory(@Param('orderId') orderId: string) {
    return this.orderHistoryService.remove(orderId);
  }
}
