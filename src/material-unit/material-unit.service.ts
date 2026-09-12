import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MaterialUnitService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.materialUnit.findMany({ orderBy: { name: 'asc' } });
  }

  /**
   * Crea la unidad si no existe todavía (alta automática cuando se escribe
   * un nombre nuevo al dar de alta un Material). No expuesto como endpoint
   * propio — mismo patrón que OrderProductPresetService.
   */
  async ensureExists(name: string): Promise<number> {
    const trimmed = name.trim();
    const unit = await this.prisma.materialUnit.upsert({
      where: { name: trimmed },
      update: {},
      create: { name: trimmed },
    });
    return unit.id;
  }
}
