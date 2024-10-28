/**
 - `company_id` `INT, PK, Auto-increment`: Identificador único de la empresa.
- `company_name` `VARCHAR`: Nombre de la empresa.
- `company_phone` `VARCHAR, NULLABLE`: Teléfono de la empresa.
- `company_email` `VARCHAR, NULLABLE`: Correo electrónico de la empresa.
- `company_address` `VARCHAR, NULLABLE`: Dirección física de la empresa.
 */

import { IsString, IsEmail, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  company_name: string;

  @IsString()
  @IsOptional()
  company_phone: string;

  @IsEmail()
  @IsOptional()
  company_email: string;

  @IsString()
  @IsOptional()
  company_address: string;

  @IsString()
  @IsOptional()
  company_location: string;
}
