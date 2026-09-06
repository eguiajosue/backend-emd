import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateBugReportDto {
  @ApiProperty({ maxLength: 2000 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  description: string;
}
