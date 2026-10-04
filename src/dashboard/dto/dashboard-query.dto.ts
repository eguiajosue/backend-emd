import { IsISO8601, IsOptional } from 'class-validator';

export class DashboardQueryDto {
  /**
   * Inicio del día en la hora LOCAL de quien mira (ISO). El servidor corre en
   * UTC: sin esto "hoy" empezaría a las 18:00 del día anterior en México.
   */
  @IsOptional()
  @IsISO8601()
  dayStart?: string;
}
