import { HttpException } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderAreaTaskService } from './order-area-task.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { AreaVisibilityService } from 'src/area-visibility/area-visibility.service';
import { OrderProductPresetService } from 'src/order-product-preset/order-product-preset.service';
import { NotificationService } from 'src/notification/notification.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';

// PNG mínimo válido (cabecera + IHDR de un pixel, generado con una lib de
// referencia): usado para probar que file-type detecta el contenido real en
// vez de confiar en el `mimeType` declarado por el cliente.
const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('OrderService - validación de archivos subidos (MIME sniffing)', () => {
  let orderService: OrderService;

  beforeEach(() => {
    orderService = new OrderService(
      {} as unknown as PrismaService,
      {} as unknown as NotificationsGateway,
      {} as unknown as AreaVisibilityService,
      {} as unknown as OrderProductPresetService,
      {} as unknown as NotificationService,
      { record: jest.fn() } as unknown as AuditLogService,
      {
        createTasksForAreas: jest.fn().mockResolvedValue([]),
      } as unknown as OrderAreaTaskService,
    );
  });

  const assertFile = (file: {
    data: string;
    filename: string;
    mimeType: string;
  }) => (orderService as any).assertAuthorizationFileSize(file);

  it('acepta un PNG real declarado como image/png', async () => {
    await expect(
      assertFile({
        data: MINIMAL_PNG_BASE64,
        filename: 'a.png',
        mimeType: 'image/png',
      }),
      // Devuelve el Buffer decodificado (se reusa para el tope por ronda).
    ).resolves.toBeInstanceOf(Buffer);
  });

  it('rechaza un PNG real declarado con un mimeType distinto (mismatch)', async () => {
    await expect(
      assertFile({
        data: MINIMAL_PNG_BASE64,
        filename: 'a.pdf',
        mimeType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('rechaza contenido que no es ninguno de los formatos permitidos, aunque el mimeType declarado sea válido', async () => {
    // Texto plano con extensión/mimeType falsificados como PNG.
    const fakeData = Buffer.from('<script>alert(1)</script>', 'utf-8').toString(
      'base64',
    );

    await expect(
      assertFile({
        data: fakeData,
        filename: 'a.png',
        mimeType: 'image/png',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('rechaza un archivo que supera el tamaño máximo', async () => {
    const bigBuffer = Buffer.alloc(6 * 1024 * 1024, 0);
    await expect(
      assertFile({
        data: bigBuffer.toString('base64'),
        filename: 'a.png',
        mimeType: 'image/png',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
