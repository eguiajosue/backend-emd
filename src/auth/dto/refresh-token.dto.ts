import { ApiProperty } from '@nestjs/swagger';
import { IsJWT, IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token devuelto por POST /auth/login' })
  @IsNotEmpty()
  @IsString()
  @IsJWT()
  refreshToken: string;
}
