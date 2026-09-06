import { Module } from '@nestjs/common';
import { ClientService } from './client.service';
import { ClientController } from './client.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { OrderModule } from 'src/order/order.module';

@Module({
  imports: [PrismaModule, OrderModule],
  controllers: [ClientController],
  providers: [ClientService],
})
export class ClientModule {}
