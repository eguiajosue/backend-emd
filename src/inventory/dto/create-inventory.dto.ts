/**
 *   inventory_id String   @id @default(cuid())
  type_id      String
  name         String
  quantity     Int
  color        String
  last_update  DateTime @updatedAt

  MaterialType   Material_Types    @relation(fields: [type_id], references: [type_id])
  OrderMaterials Order_Materials[]
 */

import { IsDate, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateInventoryDto {
  @IsString()
  @IsNotEmpty()
  type_id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @IsNotEmpty()
  quantity: number;

  @IsString()
  @IsNotEmpty()
  color: string;

  @IsDate()
  @IsNotEmpty()
  last_update: Date;
}
