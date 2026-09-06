import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class CreateDirectConversationDto {
  @ApiProperty({ description: 'Id del otro usuario del mensaje directo' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId: number;
}
