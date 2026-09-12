import { Module } from '@nestjs/common';
import { MaterialUnitService } from './material-unit.service';
import { MaterialUnitController } from './material-unit.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MaterialUnitController],
  providers: [MaterialUnitService],
  exports: [MaterialUnitService],
})
export class MaterialUnitModule {}
