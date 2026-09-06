import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrderProductPresetService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.orderProductPreset.findMany({
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Crea el preset si no existe todavía (alta automática cuando recepción
   * escribe un nombre de producto nuevo al crear un pedido). No expuesto
   * como endpoint propio.
   */
  async ensureExists(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    await this.prisma.orderProductPreset.upsert({
      where: { name: trimmed },
      update: {},
      create: { name: trimmed },
    });
  }
}
