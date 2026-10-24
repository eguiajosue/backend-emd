import { Module } from '@nestjs/common';
import { AreaVisibilityService } from './area-visibility.service';
import { AreaVisibilityController } from './area-visibility.controller';

@Module({
  controllers: [AreaVisibilityController],
  providers: [AreaVisibilityService],
  exports: [AreaVisibilityService],
})
export class AreaVisibilityModule {}
