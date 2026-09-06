import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateAreaVisibilityDto {
  @ApiProperty()
  @IsBoolean()
  generalViewEnabled: boolean;
}
