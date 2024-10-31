import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  async create(createProductDto: CreateProductDto) {
    try {
      const { productTypeId, colorId, sizeId, code, quantity } =
        createProductDto;

      const data: Prisma.ProductCreateInput = {
        quantity,
        code: code ?? null,
        productType: {
          connect: { id: productTypeId },
        },
        color: colorId ? { connect: { id: colorId } } : undefined,
        size: sizeId ? { connect: { id: sizeId } } : undefined,
      };

      const product = await this.prisma.product.create({
        data,
        include: {
          productType: true,
          color: true,
          size: true,
        },
      });
      return product;
    } catch (error) {
      if (error.code === 'P2003') {
        // Fallo en restricción de clave foránea
        throw new HttpException(
          'ID de tipo de producto, color o tamaño inválido',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        'Error al crear el producto: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findAll() {
    try {
      return await this.prisma.product.findMany({
        include: {
          productType: true,
          color: true,
          size: true,
        },
      });
    } catch (error) {
      throw new HttpException(
        'Error al obtener los productos: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findOne(id: number) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
        include: {
          productType: true,
          color: true,
          size: true,
        },
      });
      if (!product) {
        throw new HttpException('Producto no encontrado', HttpStatus.NOT_FOUND);
      }
      return product;
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw error;
      }
      throw new HttpException(
        'Error al obtener el producto: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async update(id: number, updateProductDto: UpdateProductDto) {
    try {
      const { productTypeId, colorId, sizeId, code, quantity } =
        updateProductDto;

      const data: Prisma.ProductUpdateInput = {
        ...(quantity !== undefined && { quantity }),
        ...(code && { code }),
        ...(productTypeId && {
          productType: {
            connect: { id: productTypeId },
          },
        }),
        ...(colorId && {
          color: {
            connect: { id: colorId },
          },
        }),
        ...(sizeId && {
          size: {
            connect: { id: sizeId },
          },
        }),
      };

      const product = await this.prisma.product.update({
        where: { id },
        data,
        include: {
          productType: true,
          color: true,
          size: true,
        },
      });
      return product;
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException('Producto no encontrado', HttpStatus.NOT_FOUND);
      }
      if (error.code === 'P2003') {
        // Fallo en restricción de clave foránea
        throw new HttpException(
          'ID de tipo de producto, color o tamaño inválido',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        'Error al actualizar el producto: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async remove(id: number) {
    try {
      await this.prisma.product.delete({
        where: { id },
      });
      return { message: 'Producto eliminado correctamente' };
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException('Producto no encontrado', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Error al eliminar el producto: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
