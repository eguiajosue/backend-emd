import { HttpStatus, Logger } from '@nestjs/common';
import { OrderService, RequestingUser } from './order.service';
import { OrderAreaTaskService } from './order-area-task.service';
import { CalendarEventService } from 'src/calendar-event/calendar-event.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { AreaVisibilityService } from 'src/area-visibility/area-visibility.service';
import { OrderProductPresetService } from 'src/order-product-preset/order-product-preset.service';
import { NotificationService } from 'src/notification/notification.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { StorageService } from 'src/storage/storage.service';
import {
  createS3StorageForTests,
  InMemoryObjectStore,
} from 'src/storage/testing/in-memory-object-store';

/** PNG real mínimo: pasa la validación por magic bytes. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const pngFile = (filename: string) => ({
  data: PNG,
  filename,
  mimeType: 'image/png',
});
const PNG_DATA_URL = `data:image/png;base64,${PNG}`;

const ADMIN: RequestingUser = { userId: 1, roles: ['admin'] };
const DESIGNER: RequestingUser = { userId: 5, roles: ['diseno'] };

/**
 * Archivos de un pedido con almacenamiento de objetos: filas legacy (base64
 * en la DB) y migradas (clave en el bucket) responden la MISMA data URL, y
 * las escrituras con driver `s3` dejan la columna base64 en null.
 */
describe('OrderService - almacenamiento de archivos (R2/S3)', () => {
  let prisma: any;
  let store: InMemoryObjectStore;
  let storage: StorageService;

  const baseOrder = {
    id: 1,
    area: 'diseno',
    assignedUserId: null,
    userId: 77,
    attendedByUserId: null,
    productionArea: 'bordado',
    status: { id: 2, name: 'en diseño' },
    histories: [],
  };

  const buildService = (withStorage: StorageService) =>
    new OrderService(
      prisma as unknown as PrismaService,
      {
        notifyNewAssignedOrder: jest.fn(),
        notifyNewOrderToArea: jest.fn(),
        notifyOrderStatusChange: jest.fn(),
      } as unknown as NotificationsGateway,
      {} as unknown as AreaVisibilityService,
      { ensureExists: jest.fn() } as unknown as OrderProductPresetService,
      {
        createNotification: jest.fn(),
        createNotificationForUsers: jest.fn(),
        userIdsForArea: jest.fn().mockResolvedValue([]),
      } as unknown as NotificationService,
      { record: jest.fn() } as unknown as AuditLogService,
      {
        createTasksForAreas: jest.fn().mockResolvedValue([]),
      } as unknown as OrderAreaTaskService,
      {
        ensureMaterialsPurchaseEvent: jest.fn(),
      } as unknown as CalendarEventService,
      withStorage,
    );

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    ({ store, storage } = createS3StorageForTests());
    prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue(baseOrder),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        delete: jest.fn().mockResolvedValue({ id: 1 }),
      },
      designRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        // Relectura de la ronda para la respuesta (select liviano).
        findUnique: jest.fn().mockResolvedValue({
          id: 100,
          orderId: 1,
          round: 1,
          montageFileName: 'a.png',
          feedbackFileName: null,
          files: [],
        }),
        create: jest.fn(),
        update: jest.fn(),
      },
      designRevisionFile: { findUnique: jest.fn() },
      orderAuditLog: { create: jest.fn() },
      orderMaterialItem: { count: jest.fn().mockResolvedValue(0) },
      status: { findUnique: jest.fn().mockResolvedValue({ id: 9 }) },
      $transaction: jest.fn().mockResolvedValue([{ id: 100 }]),
    };
  });

  afterEach(() => jest.restoreAllMocks());

  describe('findOne: clientResourceFile', () => {
    it('fila migrada: lee el bucket y responde la misma data URL, sin exponer la clave', async () => {
      await store.put(
        'orders/client-resources/k.png',
        Buffer.from(PNG, 'base64'),
        'image/png',
      );
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        clientResourceFileData: null,
        clientResourceFileKey: 'orders/client-resources/k.png',
        clientResourceFileName: 'logo.png',
        clientResourceFileMime: 'image/png',
      });

      const result: any = await buildService(storage).findOne(1, ADMIN);

      expect(result.clientResourceFile).toEqual({
        filename: 'logo.png',
        mimeType: 'image/png',
        dataUrl: PNG_DATA_URL,
      });
      expect(result).not.toHaveProperty('clientResourceFileKey');
      expect(result).not.toHaveProperty('clientResourceFileData');
    });

    it('fila legacy: sigue saliendo de la columna aunque el driver sea s3', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        clientResourceFileData: PNG,
        clientResourceFileKey: null,
        clientResourceFileName: 'logo.png',
        clientResourceFileMime: 'image/png',
      });

      const result: any = await buildService(storage).findOne(1, ADMIN);

      expect(result.clientResourceFile.dataUrl).toBe(PNG_DATA_URL);
    });

    it('sin archivo: null', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        clientResourceFileData: null,
        clientResourceFileKey: null,
      });
      const result: any = await buildService(storage).findOne(1, ADMIN);
      expect(result.clientResourceFile).toBeNull();
    });
  });

  describe('update: reemplazo del archivo del cliente', () => {
    it('driver s3: sube el nuevo, deja la columna en null y borra el objeto anterior', async () => {
      await store.put('viejo.png', Buffer.from('x'), 'image/png');
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        clientResourceFileKey: 'viejo.png',
      });
      prisma.order.update.mockResolvedValue({ ...baseOrder });

      await buildService(storage).update(1, {
        clientResourceFile: pngFile('nuevo.png'),
      } as any);

      const data = prisma.order.update.mock.calls[0][0].data;
      expect(data.clientResourceFileData).toBeNull();
      expect(data.clientResourceFileKey).toMatch(
        /^orders\/client-resources\/.+\.png$/,
      );
      expect(store.base64(data.clientResourceFileKey)).toBe(PNG);
      expect(store.objects.has('viejo.png')).toBe(false);
    });

    it('driver db: base64 en la columna y clave en null (comportamiento de siempre)', async () => {
      prisma.order.update.mockResolvedValue({ ...baseOrder });

      await buildService(StorageService.database()).update(1, {
        clientResourceFile: pngFile('nuevo.png'),
      } as any);

      const data = prisma.order.update.mock.calls[0][0].data;
      expect(data.clientResourceFileData).toBe(PNG);
      expect(data.clientResourceFileKey).toBeNull();
    });

    it('si la escritura en la DB falla, borra el objeto recién subido', async () => {
      prisma.order.update.mockRejectedValue(new Error('DB caída'));

      await expect(
        buildService(storage).update(1, {
          clientResourceFile: pngFile('nuevo.png'),
        } as any),
      ).rejects.toThrow('DB caída');
      expect(store.objects.size).toBe(0);
    });
  });

  describe('rondas de diseño', () => {
    it('createDesignRevision (s3): cada archivo al bucket una vez; el escalar legacy comparte el objeto del primero', async () => {
      await buildService(storage).createDesignRevision(
        1,
        { montageFiles: [pngFile('a.png'), pngFile('b.png')] },
        DESIGNER,
      );

      const data = prisma.designRevision.create.mock.calls[0][0].data;
      const files = data.files.create;
      expect(data.montageFileData).toBeNull();
      expect(data.montageFileKey).toBe(files[0].dataKey);
      expect(files.map((f: any) => f.data)).toEqual([null, null]);
      expect(files[0].dataKey).not.toBe(files[1].dataKey);
      expect(store.objects.size).toBe(2);
      expect(store.base64(files[1].dataKey)).toBe(PNG);
    });

    it('createDesignRevision (db): base64 en las columnas como siempre', async () => {
      await buildService(StorageService.database()).createDesignRevision(
        1,
        { montageFile: pngFile('a.png') },
        DESIGNER,
      );

      const data = prisma.designRevision.create.mock.calls[0][0].data;
      expect(data.montageFileData).toBe(PNG);
      expect(data.montageFileKey).toBeNull();
      expect(data.files.create[0]).toMatchObject({ data: PNG, dataKey: null });
    });

    it('createDesignRevision (s3): si la transacción falla no quedan objetos huérfanos', async () => {
      prisma.$transaction.mockRejectedValue(new Error('conflicto'));

      await expect(
        buildService(storage).createDesignRevision(
          1,
          { montageFiles: [pngFile('a.png'), pngFile('b.png')] },
          DESIGNER,
        ),
      ).rejects.toThrow('conflicto');
      expect(store.objects.size).toBe(0);
    });

    it('addDesignFeedback (s3): adjuntos al bucket y escalar legacy con la clave del primero', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        area: 'recepcion',
        status: { name: 'esperando autorización' },
      });
      prisma.designRevision.findUnique.mockResolvedValue({
        id: 100,
        orderId: 1,
        round: 1,
        approved: false,
        feedbackText: null,
        sentByUserId: 5,
        files: [],
      });

      await buildService(storage).addDesignFeedback(
        1,
        100,
        { feedbackText: 'más grande', feedbackFiles: [pngFile('f.png')] },
        { userId: 2, roles: ['recepcion'] },
      );

      const data = prisma.designRevision.update.mock.calls[0][0].data;
      expect(data.feedbackFileData).toBeNull();
      expect(data.feedbackFileKey).toBe(data.files.create[0].dataKey);
      expect(store.base64(data.feedbackFileKey)).toBe(PNG);
    });

    it('getDesignRevisionMontageFile / getDesignRevisionFile leen el bucket con la misma respuesta', async () => {
      await store.put('m.png', Buffer.from(PNG, 'base64'), 'image/png');
      prisma.designRevision.findUnique.mockResolvedValue({
        id: 100,
        orderId: 1,
        montageFileData: null,
        montageFileKey: 'm.png',
        montageFileName: 'a.png',
        montageFileMime: 'image/png',
      });
      prisma.designRevisionFile.findUnique.mockResolvedValue({
        id: 500,
        revisionId: 100,
        data: null,
        dataKey: 'm.png',
        filename: 'a.png',
        mimeType: 'image/png',
      });
      const service = buildService(storage);

      await expect(
        service.getDesignRevisionMontageFile(1, 100, ADMIN),
      ).resolves.toEqual({
        filename: 'a.png',
        mimeType: 'image/png',
        dataUrl: PNG_DATA_URL,
      });
      await expect(
        service.getDesignRevisionFile(1, 100, 500, ADMIN),
      ).resolves.toEqual({
        filename: 'a.png',
        mimeType: 'image/png',
        dataUrl: PNG_DATA_URL,
      });
    });

    it('getDesignRevisionFeedbackFile: 404 si la ronda no tiene archivo ni clave', async () => {
      prisma.designRevision.findUnique.mockResolvedValue({
        id: 100,
        orderId: 1,
        feedbackFileData: null,
        feedbackFileKey: null,
      });
      await expect(
        buildService(storage).getDesignRevisionFeedbackFile(1, 100, ADMIN),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });

    it('un objeto que falta en el bucket es un 500, no una data URL rota', async () => {
      prisma.designRevision.findUnique.mockResolvedValue({
        id: 100,
        orderId: 1,
        montageFileData: null,
        montageFileKey: 'no-existe.png',
        montageFileMime: 'image/png',
      });
      await expect(
        buildService(storage).getDesignRevisionMontageFile(1, 100, ADMIN),
      ).rejects.toMatchObject({ status: HttpStatus.INTERNAL_SERVER_ERROR });
    });
  });

  describe('remove', () => {
    it('junta las claves ANTES de borrar y borra los objetos (deduplicados) después', async () => {
      for (const key of [
        'cliente.pdf',
        'm1.png',
        'm2.png',
        'fb.png',
        'mk.png',
      ]) {
        await store.put(key, Buffer.from('x'), 'image/png');
      }
      await store.put('otro-pedido.png', Buffer.from('x'), 'image/png');
      prisma.order.findMany.mockResolvedValue([
        {
          clientResourceFileKey: 'cliente.pdf',
          designRevisions: [
            {
              montageFileKey: 'm1.png',
              feedbackFileKey: 'fb.png',
              files: [
                { dataKey: 'm1.png' },
                { dataKey: 'm2.png' },
                { dataKey: 'fb.png' },
                { dataKey: null },
              ],
            },
          ],
          mockups: [{ imageKey: 'mk.png' }, { imageKey: null }],
        },
      ]);
      const deleteOrder = prisma.order.delete;

      await expect(buildService(storage).remove(1)).resolves.toEqual({
        message: 'Orden eliminada correctamente',
      });

      expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({ id: 1 });
      expect(prisma.order.findMany.mock.invocationCallOrder[0]).toBeLessThan(
        deleteOrder.mock.invocationCallOrder[0],
      );
      expect([...store.objects.keys()]).toEqual(['otro-pedido.png']);
    });

    it('si el pedido no existe responde 404 y no borra nada del bucket', async () => {
      await store.put('k', Buffer.from('x'), 'image/png');
      prisma.order.delete.mockRejectedValue({ code: 'P2025' });

      await expect(buildService(storage).remove(1)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
      expect(store.objects.size).toBe(1);
    });

    it('un fallo al borrar del bucket no rompe el borrado del pedido', async () => {
      prisma.order.findMany.mockResolvedValue([
        { clientResourceFileKey: 'k', designRevisions: [], mockups: [] },
      ]);
      jest.spyOn(store, 'delete').mockRejectedValue(new Error('R2 caído'));

      await expect(buildService(storage).remove(1)).resolves.toEqual({
        message: 'Orden eliminada correctamente',
      });
    });
  });
});
