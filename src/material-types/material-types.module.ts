import { Module } from '@nestjs/common';
import { MaterialTypesService } from './material-types.service';
import { MaterialTypesController } from './material-types.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MaterialTypesController],
  providers: [MaterialTypesService],
})
export class MaterialTypesModule {}
