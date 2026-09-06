import { Module } from '@nestjs/common';
import { OrderProductPresetService } from './order-product-preset.service';
import { OrderProductPresetController } from './order-product-preset.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [OrderProductPresetController],
  providers: [OrderProductPresetService],
  exports: [OrderProductPresetService],
})
export class OrderProductPresetModule {}
