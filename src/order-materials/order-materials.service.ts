import { Injectable } from '@nestjs/common';
import { CreateOrderMaterialDto } from './dto/create-order-material.dto';
import { UpdateOrderMaterialDto } from './dto/update-order-material.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class OrderMaterialsService {
  constructor(private prisma: PrismaService) {}
  create(createOrderMaterialDto: CreateOrderMaterialDto) {
    return 'This action adds a new orderMaterial';
  }

  async findAll() {
    return await this.prisma.order_Materials.findMany();
  }

  findOne(id: string) {
    return `This action returns a #${id} orderMaterial`;
  }

  update(id: string, updateOrderMaterialDto: UpdateOrderMaterialDto) {
    return `This action updates a #${id} orderMaterial`;
  }

  remove(id: string) {
    return `This action removes a #${id} orderMaterial`;
  }
}
