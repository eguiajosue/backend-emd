import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInventoryTransactionDto } from './dto/create-inventory-transaction.dto';
import { UpdateInventoryTransactionDto } from './dto/update-inventory-transaction.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class InventoryTransactionService {
  constructor(private prisma: PrismaService) {}

  async create(createInventoryTransactionDto: CreateInventoryTransactionDto) {
    try {
      const { productId, quantityChange, transactionDate, notes } =
        createInventoryTransactionDto;

      const data: Prisma.InventoryTransactionCreateInput = {
        quantityChange,
        transactionDate: transactionDate
          ? new Date(transactionDate)
          : undefined,
        notes: notes ?? null,
        product: {
          connect: { id: productId },
        },
      };

      const inventoryTransaction =
        await this.prisma.inventoryTransaction.create({
          data,
          include: {
            product: true,
          },
        });
      return inventoryTransaction;
    } catch (error) {
      if (error.code === 'P2003') {
        // Fallo en restricción de clave foránea
        throw new HttpException(
          'ID de producto inválido',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        'Error al crear la transacción de inventario: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findAll() {
    try {
      return await this.prisma.inventoryTransaction.findMany({
        include: {
          product: true,
        },
      });
    } catch (error) {
      throw new HttpException(
        'Error al obtener las transacciones de inventario: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findOne(id: number) {
    try {
      const inventoryTransaction =
        await this.prisma.inventoryTransaction.findUnique({
          where: { id },
          include: {
            product: true,
          },
        });
      if (!inventoryTransaction) {
        throw new HttpException(
          'Transacción de inventario no encontrada',
          HttpStatus.NOT_FOUND,
        );
      }
      return inventoryTransaction;
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw error;
      }
      throw new HttpException(
        'Error al obtener la transacción de inventario: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async update(
    id: number,
    updateInventoryTransactionDto: UpdateInventoryTransactionDto,
  ) {
    try {
      const { productId, quantityChange, transactionDate, notes } =
        updateInventoryTransactionDto;

      const data: Prisma.InventoryTransactionUpdateInput = {
        ...(quantityChange !== undefined && { quantityChange }),
        ...(transactionDate && { transactionDate: new Date(transactionDate) }),
        ...(notes && { notes }),
        ...(productId && {
          product: {
            connect: { id: productId },
          },
        }),
      };

      const inventoryTransaction =
        await this.prisma.inventoryTransaction.update({
          where: { id },
          data,
          include: {
            product: true,
          },
        });
      return inventoryTransaction;
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException(
          'Transacción de inventario no encontrada',
          HttpStatus.NOT_FOUND,
        );
      }
      if (error.code === 'P2003') {
        // Fallo en restricción de clave foránea
        throw new HttpException(
          'ID de producto inválido',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        'Error al actualizar la transacción de inventario',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async remove(id: number) {
    try {
      await this.prisma.inventoryTransaction.delete({
        where: { id },
      });
      return { message: 'Transacción de inventario eliminada correctamente' };
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException(
          'Transacción de inventario no encontrada',
          HttpStatus.NOT_FOUND,
        );
      }
      throw new HttpException(
        'Error al eliminar la transacción de inventario',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
