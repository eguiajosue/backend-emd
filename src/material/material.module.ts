import { Module } from '@nestjs/common';
import { MaterialService } from './material.service';
import { MaterialController } from './material.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MaterialCategoryModule } from 'src/material-category/material-category.module';
import { MaterialUnitModule } from 'src/material-unit/material-unit.module';

@Module({
  imports: [PrismaModule, MaterialCategoryModule, MaterialUnitModule],
  controllers: [MaterialController],
  providers: [MaterialService],
  exports: [MaterialService],
})
export class MaterialModule {}
