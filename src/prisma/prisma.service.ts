import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { EventEmitter } from 'node:events';

/** Escrituras que se publican en `PrismaService.changes`. */
const WRITE_ACTIONS = new Set<Prisma.PrismaAction>([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

/** Una escritura ya hecha: modelo, acción, argumentos y resultado. */
export interface DataChange {
  model: Prisma.ModelName;
  action: Prisma.PrismaAction;
  args: any;
  result: unknown;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Feed de escrituras (evento `'change'` con un `DataChange`) para
   * reaccionar a cambios de datos sin tocar cada servicio que escribe:
   * tiempo real de los Inicio (RealtimeService) y aprendizaje por cliente
   * (ClientInsightService). Se emite DESPUÉS de cada escritura; dentro de una
   * transacción interactiva puede llegar antes del commit, así que quien
   * escucha agrupa los avisos con un pequeño retraso. Los oyentes tienen que
   * ser síncronos y livianos (agendar, no trabajar).
   */
  readonly changes = new EventEmitter();

  constructor() {
    super();
    this.changes.setMaxListeners(20);
    this.$use(async (params, next) => {
      const result = await next(params);
      if (params.model && WRITE_ACTIONS.has(params.action)) {
        const change: DataChange = {
          model: params.model,
          action: params.action,
          args: params.args,
          result,
        };
        try {
          this.changes.emit('change', change);
        } catch (error) {
          // Un oyente roto nunca puede hacer fallar una escritura ya hecha.
          this.logger.warn(
            `Oyente de cambios con error: ${error?.message ?? error}`,
          );
        }
      }
      return result;
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
