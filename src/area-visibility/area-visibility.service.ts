import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OPERATIONAL_ROLES } from 'src/order/role-stage-mapping';

@Injectable()
export class AreaVisibilityService {
  constructor(private prisma: PrismaService) {}

  /**
   * Devuelve la configuración de visibilidad de los 6 roles operativos,
   * creando (con default generalViewEnabled=true) la de cualquiera que
   * todavía no exista en la tabla.
   */
  async findAll() {
    const existing = await this.prisma.areaVisibilitySetting.findMany();
    const existingRoles = new Set(existing.map((s) => s.role));

    const missing = OPERATIONAL_ROLES.filter((r) => !existingRoles.has(r));
    if (missing.length > 0) {
      await Promise.all(
        missing.map((role) =>
          this.prisma.areaVisibilitySetting.upsert({
            where: { role },
            update: {},
            create: { role, generalViewEnabled: true },
          }),
        ),
      );
      return this.prisma.areaVisibilitySetting.findMany({
        where: { role: { in: OPERATIONAL_ROLES } },
      });
    }

    return existing;
  }

  async update(role: string, generalViewEnabled: boolean) {
    if (
      !OPERATIONAL_ROLES.includes(role as (typeof OPERATIONAL_ROLES)[number])
    ) {
      throw new HttpException(
        `Rol inválido: "${role}". Debe ser uno de: ${OPERATIONAL_ROLES.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.prisma.areaVisibilitySetting.upsert({
      where: { role },
      update: { generalViewEnabled },
      create: { role, generalViewEnabled },
    });
  }
}
