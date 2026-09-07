import { HttpException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { OrderService } from 'src/order/order.service';

// PNG mínimo válido (cabecera + IHDR de un pixel), mismo fixture que
// `order.file-validation.spec.ts`: usado para probar que file-type detecta
// el contenido real en vez de confiar en el `mimeType` declarado.
const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('ChatService - validación de adjuntos (fotos/documentos/audios)', () => {
  let chatService: ChatService;

  beforeEach(() => {
    chatService = new ChatService(
      {} as unknown as PrismaService,
      {} as unknown as NotificationsGateway,
      {} as unknown as OrderService,
    );
  });

  const assertAttachment = (attachment: {
    data: string;
    filename: string;
    mimeType: string;
  }) => (chatService as any).assertChatAttachmentValid(attachment);

  it('acepta una foto (PNG real) declarada como image/png', async () => {
    const buffer = await assertAttachment({
      data: MINIMAL_PNG_BASE64,
      filename: 'foto.png',
      mimeType: 'image/png',
    });
    expect(Buffer.isBuffer(buffer)).toBe(true);
  });

  it('rechaza un archivo cuyo mimeType declarado no coincide con su contenido real', async () => {
    await expect(
      assertAttachment({
        data: MINIMAL_PNG_BASE64,
        filename: 'nota.pdf',
        mimeType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('rechaza contenido que no es ninguno de los formatos permitidos (fotos/documentos/audios)', async () => {
    const fakeData = Buffer.from('<script>alert(1)</script>', 'utf-8').toString(
      'base64',
    );

    await expect(
      assertAttachment({
        data: fakeData,
        filename: 'audio.mp3',
        mimeType: 'audio/mpeg',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('rechaza un adjunto que supera el tamaño máximo (5MB)', async () => {
    const bigBuffer = Buffer.alloc(6 * 1024 * 1024, 0);
    await expect(
      assertAttachment({
        data: bigBuffer.toString('base64'),
        filename: 'foto.png',
        mimeType: 'image/png',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
