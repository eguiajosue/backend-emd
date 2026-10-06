import { Logger } from '@nestjs/common';
import { ChatService } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { OrderService } from 'src/order/order.service';
import { NotificationService } from 'src/notification/notification.service';
import { StorageService } from 'src/storage/storage.service';
import {
  createS3StorageForTests,
  InMemoryObjectStore,
} from 'src/storage/testing/in-memory-object-store';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_DATA_URL = `data:image/png;base64,${PNG}`;
const RECEPCION = { userId: 5, roles: ['recepcion'] };

/** Adjuntos del chat con almacenamiento de objetos (driver db y s3). */
describe('ChatService - adjuntos en el almacenamiento (R2/S3)', () => {
  let prisma: any;
  let gateway: { emitChatMessage: jest.Mock };
  let store: InMemoryObjectStore;
  let storage: StorageService;

  const sender = {
    id: 5,
    username: 'recep',
    firstName: 'Ana',
    lastName: 'Gómez',
  };

  const buildService = (withStorage: StorageService) =>
    new ChatService(
      prisma as unknown as PrismaService,
      gateway as unknown as NotificationsGateway,
      { assertOrderAccess: jest.fn() } as unknown as OrderService,
      {
        createNotificationForUsers: jest.fn(),
      } as unknown as NotificationService,
      withStorage,
    );

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    ({ store, storage } = createS3StorageForTests());
    prisma = {
      chatConversation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          type: 'area',
          area: 'taller',
          directUserAId: null,
          directUserBId: null,
        }),
        update: jest.fn(),
      },
      chatConversationMember: {
        deleteMany: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      chatMessage: {
        create: jest.fn(async ({ data }) => ({
          id: 100,
          conversationId: 1,
          body: data.body,
          createdAt: new Date('2026-01-02'),
          senderId: 5,
          sender,
          orderId: null,
          order: null,
          attachmentFilename: data.attachmentFilename ?? null,
          attachmentMimeType: data.attachmentMimeType ?? null,
          attachmentSize: data.attachmentSize ?? null,
        })),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 5 }, { id: 7 }]),
      },
    };
    gateway = { emitChatMessage: jest.fn() };
  });

  afterEach(() => jest.restoreAllMocks());

  const attachment = {
    data: PNG,
    filename: 'foto.png',
    mimeType: 'image/png',
  };

  describe('sendMessage', () => {
    it('driver s3: sube el adjunto, guarda sólo la clave y responde/emite la misma data URL', async () => {
      const result: any = await buildService(storage).sendMessage(
        1,
        undefined,
        RECEPCION,
        undefined,
        attachment,
      );

      const data = prisma.chatMessage.create.mock.calls[0][0].data;
      expect(data.attachmentData).toBeNull();
      expect(data.attachmentKey).toMatch(/^chat\/attachments\/.+\.png$/);
      expect(store.base64(data.attachmentKey)).toBe(PNG);
      // El select de la respuesta ya no arrastra el base64.
      expect(
        prisma.chatMessage.create.mock.calls[0][0].select.attachmentData,
      ).toBeUndefined();

      const expected = {
        filename: 'foto.png',
        mimeType: 'image/png',
        size: Buffer.from(PNG, 'base64').length,
        dataUrl: PNG_DATA_URL,
      };
      expect(result.attachment).toEqual(expected);
      expect(gateway.emitChatMessage.mock.calls[0][1].attachment).toEqual(
        expected,
      );
    });

    it('driver db: base64 en la columna, sin clave', async () => {
      const result: any = await buildService(
        StorageService.database(),
      ).sendMessage(1, undefined, RECEPCION, undefined, attachment);

      const data = prisma.chatMessage.create.mock.calls[0][0].data;
      expect(data.attachmentData).toBe(PNG);
      expect(data.attachmentKey).toBeNull();
      expect(result.attachment.dataUrl).toBe(PNG_DATA_URL);
    });

    it('si la fila no se crea, borra el objeto subido', async () => {
      prisma.chatMessage.create.mockRejectedValue(new Error('FK'));
      await expect(
        buildService(storage).sendMessage(
          1,
          undefined,
          RECEPCION,
          undefined,
          attachment,
        ),
      ).rejects.toThrow('FK');
      expect(store.objects.size).toBe(0);
    });
  });

  describe('findMessages', () => {
    const row = (overrides: Record<string, unknown>) => ({
      id: 1,
      conversationId: 1,
      body: null,
      createdAt: new Date('2026-01-02'),
      senderId: 5,
      sender,
      orderId: null,
      order: null,
      attachmentData: null,
      attachmentKey: null,
      attachmentFilename: 'foto.png',
      attachmentMimeType: 'image/png',
      attachmentSize: 70,
      ...overrides,
    });

    it('mezcla filas legacy y migradas con la misma forma; un objeto perdido sale sin dataUrl', async () => {
      await store.put(
        'chat/attachments/k.png',
        Buffer.from(PNG, 'base64'),
        'image/png',
      );
      prisma.chatMessage.findMany.mockResolvedValue([
        row({ id: 3, attachmentKey: 'chat/attachments/k.png' }),
        row({ id: 2, attachmentData: PNG }),
        row({ id: 1, attachmentKey: 'chat/attachments/perdido.png' }),
        row({
          id: 0,
          body: 'sin adjunto',
          attachmentFilename: null,
          attachmentMimeType: null,
          attachmentSize: null,
        }),
      ]);

      const result = (await buildService(storage).findMessages(
        1,
        RECEPCION,
      )) as any[];

      expect(prisma.chatMessage.findMany.mock.calls[0][0].select).toMatchObject(
        { attachmentData: true, attachmentKey: true },
      );
      expect(result[0].attachment.dataUrl).toBe(PNG_DATA_URL);
      expect(result[1].attachment.dataUrl).toBe(PNG_DATA_URL);
      expect(result[2].attachment).toEqual({
        filename: 'foto.png',
        mimeType: 'image/png',
        size: 70,
      });
      expect(result[3].attachment).toBeNull();
      for (const message of result) {
        expect(message).not.toHaveProperty('attachmentData');
        expect(message).not.toHaveProperty('attachmentKey');
      }
    });
  });
});
