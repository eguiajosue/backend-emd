import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Preferencias de usuario (tema, color de acento, idioma) persistidas por
 * cuenta en el backend, en vez de en localStorage del navegador.
 */
export class UpdateUserPreferencesDto {
  @ApiPropertyOptional({ enum: ['light', 'dark', 'system'] })
  @IsOptional()
  @IsIn(['light', 'dark', 'system'])
  themePreference?: string;

  @ApiPropertyOptional({
    description:
      'Nombre de preset (ej "rose") o color hex custom (ej "#3366ff").',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  accentColor?: string;

  @ApiPropertyOptional({ enum: ['es', 'en'] })
  @IsOptional()
  @IsIn(['es', 'en'])
  languagePreference?: string;

  @ApiPropertyOptional({
    description: 'Intensidad del efecto Liquid Glass, 0-100.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  glassIntensity?: number;

  @ApiPropertyOptional({ enum: ['comfortable', 'compact'] })
  @IsOptional()
  @IsIn(['comfortable', 'compact'])
  density?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasSeenOnboarding?: boolean;

  // Cómo prefiere ver este usuario sus tareas de producción: todas juntas
  // etiquetadas por área, o separadas por área. Es preferencia personal, no la
  // impone el admin (WORKFLOW.md §4).
  @ApiPropertyOptional({ enum: ['unified', 'split'] })
  @IsOptional()
  @IsIn(['unified', 'split'])
  areaViewMode?: string;

  @ApiPropertyOptional({ enum: ['24h', '12h'] })
  @IsOptional()
  @IsIn(['24h', '12h'])
  timeFormatPreference?: string;

  // Preferencias de notificaciones (Fase 4). Ver NotificationService para
  // cómo se aplican al decidir si se persiste/pushea cada notificación.
  @ApiPropertyOptional({
    description:
      'Modo silencio general: si está activo, no se persisten ni pushean notificaciones.',
  })
  @IsOptional()
  @IsBoolean()
  notificationsMuted?: boolean;

  @ApiPropertyOptional({
    description:
      'Sólo notificar menciones directas (sin efecto práctico hasta que exista ese tipo de notificación).',
  })
  @IsOptional()
  @IsBoolean()
  notifyMentionsOnly?: boolean;

  @ApiPropertyOptional({
    description:
      'Notificar cambios de estado/asignación de pedidos y novedades de producción.',
  })
  @IsOptional()
  @IsBoolean()
  notifyProductionUpdates?: boolean;

  @ApiPropertyOptional({
    description: 'Notificar alertas críticas.',
  })
  @IsOptional()
  @IsBoolean()
  notifyCriticalAlerts?: boolean;
}
