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
import { Auth } from 'src/common/decorators/auth.decorator';
import { Role } from 'src/common/enums/roles.enum';

@Controller('order-products')
export class OrderProductController {
  constructor(private readonly orderProductService: OrderProductService) {}

  @Post()
  @Auth(Role.RECEPCION)
  create(@Body() createOrderProductDto: CreateOrderProductDto) {
    return this.orderProductService.create(createOrderProductDto);
  }

  @Get()
  @Auth(Role.ADMIN, Role.RECEPCION)
  findAll() {
    return this.orderProductService.findAll();
  }

  @Get(':orderId/:productId')
  @Auth(Role.ADMIN, Role.RECEPCION)
  findOne(
    @Param('orderId') orderId: string,
    @Param('productId') productId: string,
  ) {
    return this.orderProductService.findOne(+orderId, +productId);
  }

  @Patch(':orderId/:productId')
  @Auth(Role.RECEPCION)
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
  @Auth(Role.RECEPCION)
  remove(
    @Param('orderId') orderId: string,
    @Param('productId') productId: string,
  ) {
    return this.orderProductService.remove(+orderId, +productId);
  }
}
