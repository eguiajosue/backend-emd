import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { OrderProductService } from './order-product.service';
import { CreateOrderProductDto } from './dto/create-order-product.dto';
import { UpdateOrderProductDto } from './dto/update-order-product.dto';

@Controller('order-products')
export class OrderProductController {
  constructor(private readonly orderProductService: OrderProductService) {}

  @Post()
  create(@Body() createOrderProductDto: CreateOrderProductDto) {
    return this.orderProductService.create(createOrderProductDto);
  }

  @Get()
  findAll() {
    return this.orderProductService.findAll();
  }

  @Get(':orderId/:productId')
  findOne(
    @Param('orderId') orderId: string,
    @Param('productId') productId: string,
  ) {
    return this.orderProductService.findOne(+orderId, +productId);
  }

  @Patch(':orderId/:productId')
  update(
    @Param('orderId') orderId: string,
    @Param('productId') productId: number,
    @Body() updateOrderProductDto: UpdateOrderProductDto,
  ) {
    return this.orderProductService.update(
      +orderId,
      +productId,
      updateOrderProductDto,
    );
  }

  @Delete(':orderId/:productId')
  remove(
    @Param('orderId') orderId: string,
    @Param('productId') productId: string,
  ) {
    return this.orderProductService.remove(+orderId, +productId);
  }
}
