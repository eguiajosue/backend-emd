import { Module } from '@nestjs/common';
import { OrderMaterialsService } from './order-materials.service';
import { OrderMaterialsController } from './order-materials.controller';

@Module({
  controllers: [OrderMaterialsController],
  providers: [OrderMaterialsService],
})
export class OrderMaterialsModule {}
