/**
 *type_id   String      @id @default(cuid())
  type_name String
  Inventory Inventory[]
 */

import { IsNotEmpty, IsString } from 'class-validator';

export class CreateMaterialTypeDto {
  @IsString()
  @IsNotEmpty()
  type_name: string;
}
