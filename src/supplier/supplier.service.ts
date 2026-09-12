import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SupplierService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSupplierDto) {
    return this.prisma.supplier.create({ data: dto });
  }

  async findAll() {
    return this.prisma.supplier.findMany({ orderBy: { name: 'asc' } });
  }

  private async findOrThrow(id: number) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new HttpException('El proveedor no existe', HttpStatus.NOT_FOUND);
    }
    return supplier;
  }

  async findOne(id: number) {
    return this.findOrThrow(id);
  }

  async update(id: number, dto: UpdateSupplierDto) {
    await this.findOrThrow(id);
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    await this.findOrThrow(id);
    await this.prisma.supplier.delete({ where: { id } });
    return { success: true };
  }
}
