import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateOrderTemplateDto,
  OrderTemplateMaterialDto,
  OrderTemplateProductDto,
  UpdateOrderTemplateDto,
} from './dto/order-template.dto';

/** Tope de plantillas por cliente: alcanza de sobra y evita listas inmanejables. */
export const MAX_TEMPLATES_PER_CLIENT = 50;

const TEMPLATE_SELECT = {
  id: true,
  clientId: true,
  name: true,
  requiresDesign: true,
  productionAreas: true,
  description: true,
  useCount: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
  products: {
    select: { customName: true, quantity: true },
    orderBy: { position: 'asc' },
  },
  materials: {
    select: {
      id: true,
      materialId: true,
      quantity: true,
      description: true,
      supplierId: true,
      material: {
        select: { id: true, name: true, unit: { select: { name: true } } },
      },
    },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.OrderTemplateSelect;

/**
 * Plantillas de pedido por cliente: lo que un cliente suele pedir, con
 * nombre, para precargar el alta. Las usa y las administra Recepción
 * (+ admin/superuser); ver OrderTemplateController.
 */
@Injectable()
export class OrderTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async findByClient(clientId: number) {
    await this.assertClientExists(clientId);
    return this.prisma.orderTemplate.findMany({
      where: { clientId },
      select: TEMPLATE_SELECT,
      // Las más usadas primero; a igualdad, la usada más recientemente.
      orderBy: [
        { useCount: 'desc' },
        { lastUsedAt: { sort: 'desc', nulls: 'last' } },
        { name: 'asc' },
      ],
    });
  }

  async findOne(id: number) {
    const template = await this.prisma.orderTemplate.findUnique({
      where: { id },
      select: TEMPLATE_SELECT,
    });
    if (!template) throw new NotFoundException('La plantilla no existe');
    return template;
  }

  async create(
    clientId: number,
    dto: CreateOrderTemplateDto,
    createdById: number,
  ) {
    await this.assertClientExists(clientId);
    this.assertRoute(dto.requiresDesign, dto.productionAreas ?? []);
    const count = await this.prisma.orderTemplate.count({
      where: { clientId },
    });
    if (count >= MAX_TEMPLATES_PER_CLIENT) {
      throw new BadRequestException(
        `Un cliente puede tener hasta ${MAX_TEMPLATES_PER_CLIENT} plantillas`,
      );
    }

    try {
      return await this.prisma.orderTemplate.create({
        data: {
          clientId,
          name: dto.name,
          requiresDesign: dto.requiresDesign,
          productionAreas: uniqueAreas(dto.productionAreas),
          description: dto.description?.trim() ?? '',
          createdById,
          products: { create: productRows(dto.products) },
          materials: { create: materialRows(dto.materials ?? []) },
        },
        select: TEMPLATE_SELECT,
      });
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  async update(id: number, dto: UpdateOrderTemplateDto) {
    const current = await this.prisma.orderTemplate.findUnique({
      where: { id },
      select: { id: true, requiresDesign: true, productionAreas: true },
    });
    if (!current) throw new NotFoundException('La plantilla no existe');
    this.assertRoute(
      dto.requiresDesign ?? current.requiresDesign,
      dto.productionAreas ?? current.productionAreas,
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.products) {
          await tx.orderTemplateProduct.deleteMany({
            where: { templateId: id },
          });
        }
        if (dto.materials) {
          await tx.orderTemplateMaterial.deleteMany({
            where: { templateId: id },
          });
        }
        return tx.orderTemplate.update({
          where: { id },
          data: {
            name: dto.name,
            requiresDesign: dto.requiresDesign,
            productionAreas: dto.productionAreas
              ? uniqueAreas(dto.productionAreas)
              : undefined,
            description:
              dto.description !== undefined
                ? dto.description.trim()
                : undefined,
            products: dto.products
              ? { create: productRows(dto.products) }
              : undefined,
            materials: dto.materials
              ? { create: materialRows(dto.materials) }
              : undefined,
          },
          select: TEMPLATE_SELECT,
        });
      });
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  async remove(id: number) {
    try {
      await this.prisma.orderTemplate.delete({ where: { id } });
    } catch (error) {
      if (error?.code === 'P2025') {
        throw new NotFoundException('La plantilla no existe');
      }
      throw error;
    }
    return { id };
  }

  /** Se llama al crear un pedido con la plantilla: ordena las más usadas primero. */
  async markUsed(id: number) {
    try {
      return await this.prisma.orderTemplate.update({
        where: { id },
        data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
        select: { id: true, useCount: true, lastUsedAt: true },
      });
    } catch (error) {
      if (error?.code === 'P2025') {
        throw new NotFoundException('La plantilla no existe');
      }
      throw error;
    }
  }

  private async assertClientExists(clientId: number) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true },
    });
    if (!client) throw new NotFoundException('El cliente no existe');
  }

  /** Misma regla que el alta: sin diseño el pedido necesita a dónde ir. */
  private assertRoute(requiresDesign: boolean, productionAreas: string[]) {
    if (!requiresDesign && productionAreas.length === 0) {
      throw new BadRequestException(
        'Una plantilla sin diseño necesita al menos un área de producción',
      );
    }
  }

  private translateWriteError(error: any) {
    if (error?.code === 'P2002') {
      return new ConflictException(
        'Este cliente ya tiene una plantilla con ese nombre',
      );
    }
    if (error?.code === 'P2003') {
      return new BadRequestException(
        'Algún material o proveedor de la plantilla no existe',
      );
    }
    if (error?.code === 'P2025') {
      return new NotFoundException('La plantilla no existe');
    }
    return error;
  }
}

function uniqueAreas(areas: string[] | undefined): string[] {
  return [...new Set(areas ?? [])];
}

function productRows(products: OrderTemplateProductDto[]) {
  return products.map((p, position) => ({
    position,
    customName: p.customName,
    quantity: p.quantity,
  }));
}

function materialRows(materials: OrderTemplateMaterialDto[]) {
  return materials.map((m, position) => ({
    position,
    materialId: m.materialId,
    quantity: m.quantity,
    description: m.description,
    supplierId: m.supplierId ?? null,
  }));
}
