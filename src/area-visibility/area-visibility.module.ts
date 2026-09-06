import { Module } from '@nestjs/common';
import { AreaVisibilityService } from './area-visibility.service';
import { AreaVisibilityController } from './area-visibility.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AreaVisibilityController],
  providers: [AreaVisibilityService],
  exports: [AreaVisibilityService],
})
export class AreaVisibilityModule {}
