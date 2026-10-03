import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeKey } from '../client-insight/client-insight.engine';

/** Ventana con la que se mide qué productos se piden más. */
const USAGE_WINDOW_DAYS = 365;

@Injectable()
export class OrderProductPresetService {
  constructor(private prisma: PrismaService) {}

  /**
   * Productos frecuentes, del más pedido al menos pedido en el último año
   * (y por nombre a igualdad): el sistema aprende de cada pedido qué se pide
   * de verdad, en vez de mostrar los primeros del abecedario. `uses` es en
   * cuántas líneas de pedido apareció.
   */
  async findAll() {
    const since = new Date(Date.now() - USAGE_WINDOW_DAYS * 86_400_000);
    const [presets, usage] = await Promise.all([
      this.prisma.orderProductPreset.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.orderProduct.groupBy({
        by: ['customName'],
        where: { order: { creationDate: { gte: since } } },
        _count: { _all: true },
      }),
    ]);
    const usesByKey = new Map<string, number>();
    for (const row of usage) {
      const key = normalizeKey(row.customName ?? '');
      usesByKey.set(key, (usesByKey.get(key) ?? 0) + row._count._all);
    }
    return presets
      .map((preset) => ({
        ...preset,
        uses: usesByKey.get(normalizeKey(preset.name)) ?? 0,
      }))
      .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name, 'es'));
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
