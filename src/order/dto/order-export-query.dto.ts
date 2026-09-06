import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString } from 'class-validator';
import { EmptyToUndefined } from 'src/common/transformers/empty-to-undefined';

export class OrderExportQueryDto {
  @ApiPropertyOptional({ description: 'Fecha de creación desde (ISO)' })
  @EmptyToUndefined()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Fecha de creación hasta (ISO)' })
  @EmptyToUndefined()
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional()
  @EmptyToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  statusId?: number;

  @ApiPropertyOptional()
  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  area?: string;

  @ApiPropertyOptional()
  @EmptyToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  clientId?: number;
}
