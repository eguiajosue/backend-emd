import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

/** Id fijo de la única fila de configuración global. */
const SETTINGS_ID = 1;
const DEFAULT_DELIVERED_RETENTION_HOURS = 48;

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Devuelve la fila única de configuración, creándola con valores por
   * defecto si todavía no existe (por ejemplo, si el seed no corrió).
   */
  async findOne() {
    return this.prisma.appSetting.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: {
        id: SETTINGS_ID,
        deliveredRetentionHours: DEFAULT_DELIVERED_RETENTION_HOURS,
      },
    });
  }

  async update(updateSettingsDto: UpdateSettingsDto) {
    return this.prisma.appSetting.upsert({
      where: { id: SETTINGS_ID },
      update: { ...updateSettingsDto },
      create: { id: SETTINGS_ID, ...updateSettingsDto },
    });
  }
}
