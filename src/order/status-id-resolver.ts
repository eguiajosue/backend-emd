import { HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Nombres de los `Status` sembrados por prisma/seed.ts. Se resuelven SIEMPRE
 * por nombre y nunca por id hardcodeado: el id depende del orden del seed, así
 * que en otra base podría diferir.
 */
export const STATUS_NAME_EN_DISENO = 'en diseño';
export const STATUS_NAME_ESPERANDO_AUTORIZACION = 'esperando autorización';
export const STATUS_NAME_CAMBIOS_SOLICITADOS = 'cambios solicitados';
export const STATUS_NAME_AUTORIZADO = 'autorizado';
/** "terminado" = listo para entregar (WORKFLOW.md §3). */
export const STATUS_NAME_TERMINADO = 'terminado';
export const STATUS_NAME_ENTREGADO = 'entregado';
export const STATUS_NAME_CANCELADO = 'cancelado';

/**
 * Resuelve ids de `Status` por nombre, con cache en memoria (los estados no
 * cambian en runtime). Cada servicio tiene su propia instancia; compartir la
 * implementación evita que unos estados se resuelvan por nombre y otros
 * queden con el id hardcodeado.
 */
export class StatusIdResolver {
  private readonly cache = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  async idFor(name: string): Promise<number> {
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached;
    const status = await this.prisma.status.findUnique({ where: { name } });
    if (!status) {
      throw new HttpException(
        `El estado "${name}" no existe. Corré el seed (prisma/seed.ts) para crearlo.`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    this.cache.set(name, status.id);
    return status.id;
  }
}
