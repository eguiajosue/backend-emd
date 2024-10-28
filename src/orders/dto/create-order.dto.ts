/**
  order_id      String      @id @default(cuid())
  client_id     String
  user_id       String
  status        OrderStatus
  description   String
  creation_date DateTime
  delivery_date DateTime?

  Client         Clients           @relation(fields: [client_id], references: [client_id])
  User           Users             @relation(fields: [user_id], references: [user_id])
  OrderHistory   Order_History[]
  OrderMaterials Order_Materials[]
 */

import { IsString } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  client_id: string;
  @IsString()
  user_id: string;
  @IsString()
  status: string;
  @IsString()
  description: string;
  @IsString()
  creation_date: Date;
  @IsString()
  delivery_date: Date;
}
