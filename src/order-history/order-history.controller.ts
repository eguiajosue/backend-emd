import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { OrderHistoryService } from './order-history.service';
import { CreateOrderHistoryDto } from './dto/create-order-history.dto';
import { UpdateOrderHistoryDto } from './dto/update-order-history.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { Role } from 'src/common/enums/roles.enum';

@Auth(
  Role.ADMIN,
  Role.RECEPCION,
  Role.SUPERUSER,
  Role.TALLER,
  Role.DTF,
  Role.BORDADO,
  Role.DISENO,
  Role.LASER,
  Role.IMPRESIONES,
)
@ApiTags('order-histories')
@Controller('order-histories')
export class OrderHistoryController {
  constructor(private readonly orderHistoryService: OrderHistoryService) {}

  @Post()
  create(@Body() createOrderHistoryDto: CreateOrderHistoryDto) {
    return this.orderHistoryService.create(createOrderHistoryDto);
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.orderHistoryService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orderHistoryService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateOrderHistoryDto: UpdateOrderHistoryDto,
  ) {
    return this.orderHistoryService.update(+id, updateOrderHistoryDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.orderHistoryService.remove(+id);
  }
}
