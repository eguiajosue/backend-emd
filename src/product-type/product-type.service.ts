import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductTypeDto } from './dto/create-product-type.dto';
import { UpdateProductTypeDto } from './dto/update-product-type.dto';

@Injectable()
export class ProductTypeService {
  constructor(private prisma: PrismaService) {}

  async create(createProductTypeDto: CreateProductTypeDto) {
    try {
      const productType = await this.prisma.productType.create({
        data: createProductTypeDto,
      });
      return productType;
    } catch (error) {
      if (error.code === 'P2002') {
        // Violación de restricción única
        throw new HttpException(
          'El nombre del tipo de producto ya existe',
          HttpStatus.BAD_REQUEST,
        );
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async findAll() {
    try {
      return await this.prisma.productType.findMany({
        include: {
          products: true,
        },
      });
    } catch (error) {
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async findOne(id: number) {
    try {
      const productType = await this.prisma.productType.findUnique({
        where: { id },
        include: {
          products: true,
        },
      });
      if (!productType) {
        throw new HttpException(
          'Tipo de producto no encontrado',
          HttpStatus.NOT_FOUND,
        );
      }
      return productType;
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw error;
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async update(id: number, updateProductTypeDto: UpdateProductTypeDto) {
    try {
      const productType = await this.prisma.productType.update({
        where: { id },
        data: updateProductTypeDto,
      });
      return productType;
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException(
          'Tipo de producto no encontrado',
          HttpStatus.NOT_FOUND,
        );
      }
      if (error.code === 'P2002') {
        // Violación de restricción única
        throw new HttpException(
          'El nombre del tipo de producto ya existe',
          HttpStatus.BAD_REQUEST,
        );
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async remove(id: number) {
    try {
      await this.prisma.productType.delete({
        where: { id },
      });
      return { message: 'Tipo de producto eliminado correctamente' };
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException(
          'Tipo de producto no encontrado',
          HttpStatus.NOT_FOUND,
        );
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }
}
