import { Module } from '@nestjs/common';
import { MaterialCategoryService } from './material-category.service';
import { MaterialCategoryController } from './material-category.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MaterialCategoryController],
  providers: [MaterialCategoryService],
  exports: [MaterialCategoryService],
})
export class MaterialCategoryModule {}
