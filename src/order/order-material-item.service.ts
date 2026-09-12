import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateOrderMaterialItemDto,
  UpdateOrderMaterialItemDto,
} from './dto/order-material-item.dto';

/**
 * Hoja de materiales de un pedido: qué material, cuánto, de qué proveedor
 * y a nombre de quién queda cargado. Opcional — no bloquea autorizar el
 * montaje ni ningún otro paso del circuito. La carga Recepción (o
 * admin/superuser) cuando el pedido pasa a producción, para que el área
 * sepa qué se va a usar.
 */
@Injectable()
export class OrderMaterialItemService {
  constructor(private readonly prisma: PrismaService) {}

  private select() {
    return {
      id: true,
      orderId: true,
      materialId: true,
      quantity: true,
      description: true,
      supplierId: true,
      createdById: true,
      createdAt: true,
      material: { select: { id: true, name: true } },
      supplier: true,
      createdBy: {
        select: { id: true, firstName: true, lastName: true, username: true },
      },
    } satisfies Prisma.OrderMaterialItemSelect;
  }

  private async assertOrderExists(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new HttpException('El pedido no existe', HttpStatus.NOT_FOUND);
    }
  }

  async findByOrder(orderId: number) {
    await this.assertOrderExists(orderId);
    return this.prisma.orderMaterialItem.findMany({
      where: { orderId },
      select: this.select(),
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(
    orderId: number,
    dto: CreateOrderMaterialItemDto,
    createdById: number,
  ) {
    await this.assertOrderExists(orderId);
    try {
      return await this.prisma.orderMaterialItem.create({
        data: {
          orderId,
          materialId: dto.materialId,
          quantity: dto.quantity,
          description: dto.description,
          supplierId: dto.supplierId,
          createdById,
        },
        select: this.select(),
      });
    } catch (error) {
      if (error.code === 'P2003') {
        throw new HttpException(
          'El material o el proveedor elegido no existe',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  private async findItemOrThrow(orderId: number, itemId: number) {
    const item = await this.prisma.orderMaterialItem.findUnique({
      where: { id: itemId },
      select: this.select(),
    });
    if (!item || item.orderId !== orderId) {
      throw new HttpException(
        'La línea de materiales no existe',
        HttpStatus.NOT_FOUND,
      );
    }
    return item;
  }

  async update(
    orderId: number,
    itemId: number,
    dto: UpdateOrderMaterialItemDto,
  ) {
    await this.findItemOrThrow(orderId, itemId);
    return this.prisma.orderMaterialItem.update({
      where: { id: itemId },
      data: {
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.supplierId !== undefined && { supplierId: dto.supplierId }),
      },
      select: this.select(),
    });
  }

  async remove(orderId: number, itemId: number) {
    await this.findItemOrThrow(orderId, itemId);
    await this.prisma.orderMaterialItem.delete({ where: { id: itemId } });
    return { success: true };
  }
}
