/**
  history_id      String      @id @default(cuid())
  order_id        String
  previous_status OrderStatus
  new_status      OrderStatus
  change_date     DateTime    @default(now())

  Order Orders @relation(fields: [order_id], references: [order_id])
 */

import { OrderStatus } from '@prisma/client';
import { IsDate, IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class CreateOrderHistoryDto {
  @IsString()
  @IsNotEmpty()
  order_id: string;

  @IsEnum(OrderStatus)
  @IsNotEmpty()
  previous_status: OrderStatus;

  @IsEnum(OrderStatus)
  @IsNotEmpty()
  new_status: OrderStatus;

  @IsDate()
  @IsNotEmpty()
  change_date: Date;
}
