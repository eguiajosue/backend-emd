import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { OrderModule } from 'src/order/order.module';
import { OrderMockupService } from './order-mockup.service';
import { OrderMockupController } from './order-mockup.controller';

/**
 * Mockups 3D adjuntados a pedidos. Importa `OrderModule` sólo para reusar
 * `OrderService.assertOrderAccess` (misma visibilidad que el pedido).
 */
@Module({
  imports: [PrismaModule, OrderModule],
  controllers: [OrderMockupController],
  providers: [OrderMockupService],
})
export class OrderMockupModule {}
