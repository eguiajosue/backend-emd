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

import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OrderStatus } from '@prisma/client';

export class CreateOrderDto {
  @IsString()
  client_id: string;
  @IsString()
  user_id: string;
  @IsEnum(OrderStatus)
  @IsOptional()
  status?: OrderStatus = OrderStatus.PENDIENTE;
  @IsString()
  description: string;
  @IsString()
  creation_date: Date;
  @IsString()
  delivery_date: Date;
}
