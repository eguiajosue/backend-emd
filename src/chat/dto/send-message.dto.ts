import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_CHAT_MESSAGE_LENGTH } from '../chat.constants';

export class SendMessageDto {
  @ApiProperty({ maxLength: MAX_CHAT_MESSAGE_LENGTH })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'El mensaje no puede estar vacío' })
  @MaxLength(MAX_CHAT_MESSAGE_LENGTH, {
    message: `El mensaje no puede superar los ${MAX_CHAT_MESSAGE_LENGTH} caracteres`,
  })
  body: string;
}
