import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

export interface RecordAuditLogInput {
  actorUserId: number;
  action: string;
  entityType: string;
  entityId: string | number;
  metadata?: Record<string, unknown>;
}

/**
 * Log de auditoría genérico, distinto de `OrderAuditLog` (que sólo cubre el
 * diff de campos de UN pedido). Se usa para eventos que no encajan ahí:
 * acciones masivas sobre varios pedidos y exportaciones CSV.
 *
 * Deliberadamente simple: sólo un `create` directo a la tabla, sin cola ni
 * batching -- el volumen de estos eventos es bajo (acciones administrativas,
 * no tráfico de usuario final) y no justifica esa complejidad.
 *
 * Nunca debe romper el flujo principal: si el registro de auditoría falla,
 * se loguea el error pero no se propaga (evita que, por ejemplo, un pedido
 * se actualice bien pero la respuesta al cliente sea un 500 sólo porque
 * fallar el audit log).
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: input.action,
          entityType: input.entityType,
          entityId: String(input.entityId),
          metadata: (input.metadata ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
        },
      });
    } catch (error) {
      this.logger.error(
        `No se pudo registrar el audit log (action=${input.action}, entityType=${input.entityType}, entityId=${input.entityId})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
