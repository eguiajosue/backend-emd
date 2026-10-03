import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { OrderTemplateService } from './order-template.service';
import { OrderTemplateController } from './order-template.controller';

@Module({
  imports: [PrismaModule],
  controllers: [OrderTemplateController],
  providers: [OrderTemplateService],
})
export class OrderTemplateModule {}
