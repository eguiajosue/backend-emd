import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
