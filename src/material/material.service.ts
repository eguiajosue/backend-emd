import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MaterialCategoryService } from '../material-category/material-category.service';
import { MaterialUnitService } from '../material-unit/material-unit.service';
import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';

/**
 * Catálogo de materiales/insumos. `category`/`unit` llegan del DTO como
 * nombre y acá se resuelven a id (dando de alta la categoría/unidad si es
 * la primera vez que se usa ese nombre — igual que OrderProductPreset con
 * los productos de un pedido).
 */
@Injectable()
export class MaterialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly materialCategoryService: MaterialCategoryService,
    private readonly materialUnitService: MaterialUnitService,
  ) {}

  private select() {
    return {
      id: true,
      name: true,
      measure: true,
      color: true,
      brand: true,
      areas: true,
      createdAt: true,
      category: true,
      unit: true,
      supplierId: true,
      supplier: true,
    } satisfies Prisma.MaterialSelect;
  }

  private async resolveCategoryId(category?: string) {
    if (category === undefined) return undefined;
    return category
      ? this.materialCategoryService.ensureExists(category)
      : null;
  }

  private async resolveUnitId(unit?: string) {
    if (unit === undefined) return undefined;
    return unit ? this.materialUnitService.ensureExists(unit) : null;
  }

  async create(dto: CreateMaterialDto) {
    const [categoryId, unitId] = await Promise.all([
      this.resolveCategoryId(dto.category),
      this.resolveUnitId(dto.unit),
    ]);
    return this.prisma.material.create({
      data: {
        name: dto.name,
        categoryId: categoryId ?? undefined,
        unitId: unitId ?? undefined,
        measure: dto.measure,
        color: dto.color,
        brand: dto.brand,
        supplierId: dto.supplierId,
        areas: dto.areas ?? [],
      },
      select: this.select(),
    });
  }

  async findAll() {
    return this.prisma.material.findMany({
      select: this.select(),
      orderBy: { name: 'asc' },
    });
  }

  private async findOrThrow(id: number) {
    const material = await this.prisma.material.findUnique({
      where: { id },
      select: this.select(),
    });
    if (!material) {
      throw new HttpException('El material no existe', HttpStatus.NOT_FOUND);
    }
    return material;
  }

  async findOne(id: number) {
    return this.findOrThrow(id);
  }

  async update(id: number, dto: UpdateMaterialDto) {
    await this.findOrThrow(id);
    const [categoryId, unitId] = await Promise.all([
      this.resolveCategoryId(dto.category),
      this.resolveUnitId(dto.unit),
    ]);
    return this.prisma.material.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(categoryId !== undefined && { categoryId }),
        ...(unitId !== undefined && { unitId }),
        ...(dto.measure !== undefined && { measure: dto.measure }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.brand !== undefined && { brand: dto.brand }),
        ...(dto.supplierId !== undefined && { supplierId: dto.supplierId }),
        ...(dto.areas !== undefined && { areas: dto.areas }),
      },
      select: this.select(),
    });
  }

  async remove(id: number) {
    await this.findOrThrow(id);
    try {
      await this.prisma.material.delete({ where: { id } });
    } catch (error) {
      if (error.code === 'P2003') {
        throw new HttpException(
          'No se puede borrar: hay pedidos con una hoja de materiales que usa este material',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
    return { success: true };
  }
}
