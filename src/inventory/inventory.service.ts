import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}
  async create(createInventoryDto: CreateInventoryDto) {
    try {
      return await this.prisma.inventory.create({
        data: createInventoryDto,
      });
    } catch (error) {
      return new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  async findAll() {
    return await this.prisma.inventory.findMany();
  }

  async findOne(id: string) {
    try {
      const existingInventory = await this.prisma.inventory.findFirst({
        where: {
          inventory_id: id,
        },
      });
      if (!existingInventory) {
        return new HttpException(
          'No existe un inventario con ese id',
          HttpStatus.NOT_FOUND,
        );
      }
      return existingInventory;
    } catch (error) {
      return new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  update(id: string, updateInventoryDto: UpdateInventoryDto) {
    try {
      const existingInventory = this.prisma.inventory.findFirst({
        where: {
          inventory_id: id,
        },
      });
      if (!existingInventory) {
        return new HttpException(
          'No existe un inventario con ese id',
          HttpStatus.NOT_FOUND,
        );
      }
      return this.prisma.inventory.update({
        where: { inventory_id: id },
        data: { ...updateInventoryDto },
      });
    } catch (error) {
      return new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  remove(id: string) {
    try {
      const existingInventory = this.prisma.inventory.findFirst({
        where: {
          inventory_id: id,
        },
      });
      if (!existingInventory) {
        return new HttpException(
          'No existe un inventario con ese id',
          HttpStatus.NOT_FOUND,
        );
      }
      return this.prisma.inventory.delete({
        where: {
          inventory_id: id,
        },
      });
    } catch (error) {
      return new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
