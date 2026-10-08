import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CoordinationController } from './coordination.controller';
import { CoordinationService } from './coordination.service';

@Module({
  imports: [PrismaModule],
  controllers: [CoordinationController],
  providers: [CoordinationService],
})
export class CoordinationModule {}
