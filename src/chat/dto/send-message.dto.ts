import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MAX_CHAT_MESSAGE_LENGTH } from '../chat.constants';

/**
 * Mime types permitidos para un adjunto de chat: mismas imágenes/PDF que la
 * hoja de autorización de pedidos (ver AUTHORIZATION_FILE_MIME_TYPES en
 * order/dto/create-order.dto.ts) más audio, ya que el chat necesita soportar
 * fotos, documentos y audios (notas de voz).
 */
export const CHAT_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'application/pdf',
  'audio/mpeg',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
] as const;

export class ChatAttachmentDto {
  /** Contenido del archivo en base64, SIN el prefijo `data:...;base64,`. */
  @IsNotEmpty()
  @IsString()
  data: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  filename: string;

  @IsNotEmpty()
  @IsIn(CHAT_ATTACHMENT_MIME_TYPES)
  mimeType: string;
}

export class SendMessageDto {
  // El texto es obligatorio sólo cuando no hay adjunto: un mensaje puede
  // ser sólo una foto/audio/documento, sin cuerpo de texto.
  @ApiPropertyOptional({ maxLength: MAX_CHAT_MESSAGE_LENGTH })
  @ValidateIf((dto: SendMessageDto) => !dto.attachment)
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'El mensaje no puede estar vacío' })
  @MaxLength(MAX_CHAT_MESSAGE_LENGTH, {
    message: `El mensaje no puede superar los ${MAX_CHAT_MESSAGE_LENGTH} caracteres`,
  })
  body?: string;

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

  /** Adjunto opcional (foto, documento o audio), en base64 igual que
   * `AuthorizationFileDto` en pedidos. */
  @ApiPropertyOptional({ type: ChatAttachmentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChatAttachmentDto)
  attachment?: ChatAttachmentDto;
}
