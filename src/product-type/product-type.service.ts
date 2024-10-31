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
      throw new HttpException(
        'Error al crear el tipo de producto: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
      throw new HttpException(
        'Error al obtener los tipos de producto: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
      throw new HttpException(
        'Error al obtener el tipo de producto: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
      throw new HttpException(
        'Error al actualizar el tipo de producto: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
      throw new HttpException(
        'Error al eliminar el tipo de producto: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
