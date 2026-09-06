import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @ApiProperty({ minimum: 1, maximum: 720 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  deliveredRetentionHours: number;
}
