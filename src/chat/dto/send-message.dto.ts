import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
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

  // Referencia opcional a un pedido, para dar contexto a la conversación.
  // No es obligatoria en cada mensaje: el usuario la agrega sólo cuando la
  // necesita. El servidor valida que quien manda tenga acceso a ese pedido
  // (mismo criterio que ver/editar el pedido), nunca confía en que el id
  // exista o sea visible sólo porque el cliente lo mandó.
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsPositive()
  orderId?: number;
}
