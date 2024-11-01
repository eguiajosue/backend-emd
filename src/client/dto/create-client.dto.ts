// create-client.dto.ts

import { IsString, IsOptional, IsNumber } from 'class-validator';

export class CreateClientDto {
  @IsString()
  first_name: string;

  @IsString()
  last_name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsNumber()
  @IsOptional()
  companyId?: number;
}
