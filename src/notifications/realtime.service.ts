import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataChange, PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

/**
 * Modelos cuyos cambios se avisan en vivo: lo que muestran los Inicio
 * (Recepción, Diseño, Producción), las listas de pedidos y tareas, el
 * inventario y el calendario.
 */
export const REALTIME_MODELS = new Set<string>([
  'Order',
  'OrderAreaTask',
  'OrderProduct',
  'OrderMaterialItem',
  'OrderHistory',
  'DesignRevision',
  'InventoryItem',
  'CalendarEvent',
]);

/** Las escrituras que llegan juntas (un alta crea pedido + tareas + ...) salen en un solo aviso. */
export const REALTIME_DEBOUNCE_MS = 800;

/**
 * Tiempo real de los Inicio: escucha el feed de escrituras de Prisma y, con
 * un pequeño retraso para agrupar, avisa por socket qué tipo de datos
 * cambió (`dataChanged`). El aviso no lleva datos: cada pantalla vuelve a
 * pedir sólo lo que le corresponde ver.
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  private readonly onChange = (change: DataChange) => {
    if (!REALTIME_MODELS.has(change.model)) return;
    this.pending.add(change.model);
    this.timer ??= setTimeout(() => this.flush(), REALTIME_DEBOUNCE_MS);
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  onModuleInit() {
    this.prisma.changes?.on('change', this.onChange);
  }

  onModuleDestroy() {
    this.prisma.changes?.off('change', this.onChange);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }

  flush() {
    this.timer = null;
    if (this.pending.size === 0) return;
    const models = [...this.pending].sort();
    this.pending.clear();
    this.gateway.notifyDataChanged(models);
  }
}
