/**
 * model Order_Materials {
  order_id      String
  inventory_id  String
  quantity_used Int

  Order     Orders    @relation(fields: [order_id], references: [order_id])
  Inventory Inventory @relation(fields: [inventory_id], references: [inventory_id])

  @@id([order_id, inventory_id])
 */

import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateOrderMaterialDto {
  @IsString()
  @IsNotEmpty()
  order_id: string;

  @IsString()
  @IsNotEmpty()
  inventory_id: string;

  @IsNumber()
  @IsNotEmpty()
  quantity_used: number;
}
