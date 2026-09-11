import { HttpException, HttpStatus } from '@nestjs/common';
import { OrderService, RequestingUser } from './order.service';
import { OrderAreaTaskService } from './order-area-task.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { AreaVisibilityService } from 'src/area-visibility/area-visibility.service';
import { OrderProductPresetService } from 'src/order-product-preset/order-product-preset.service';
import { NotificationService } from 'src/notification/notification.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';

/** PNG real mínimo: pasa la validación por magic bytes (ver file-validation). */
const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const pngFile = (name: string) => ({
  data: MINIMAL_PNG_BASE64,
  filename: name,
  mimeType: 'image/png',
});

/** Id del creador del pedido: la recepcionista que lo dio de alta. */
const CREATOR_USER_ID = 77;

describe('OrderService - flujo de diseño', () => {
  let orderService: OrderService;
  let prisma: any;
  let notificationService: {
    createNotification: jest.Mock;
    createNotificationForUsers: jest.Mock;
    userIdsForArea: jest.Mock;
  };
  let gateway: {
    notifyNewAssignedOrder: jest.Mock;
    notifyNewOrderToArea: jest.Mock;
  };

  const designer: RequestingUser = { userId: 5, roles: ['diseno'] };
  const receptionist: RequestingUser = { userId: 1, roles: ['recepcion'] };

  beforeEach(() => {
    prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          area: 'diseno',
          assignedUserId: null,
          userId: CREATOR_USER_ID,
          productionArea: 'bordado',
        }),
        update: jest.fn(),
      },
      designRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 100,
          orderId: 1,
          round: 1,
          montageFileName: 'a.png',
          feedbackFileName: null,
          sentByUserId: 5,
          files: [
            {
              id: 500,
              kind: 'montage',
              filename: 'a.png',
              mimeType: 'image/png',
            },
            {
              id: 501,
              kind: 'montage',
              filename: 'b.png',
              mimeType: 'image/png',
            },
          ],
        }),
        create: jest.fn(),
        update: jest.fn(),
      },
      designRevisionFile: { findUnique: jest.fn() },
      orderAuditLog: { create: jest.fn() },
      status: { findUnique: jest.fn().mockResolvedValue({ id: 9 }) },
      $transaction: jest.fn().mockResolvedValue([{ id: 100 }]),
    };
    notificationService = {
      createNotification: jest.fn().mockResolvedValue(undefined),
      createNotificationForUsers: jest.fn().mockResolvedValue(undefined),
      userIdsForArea: jest.fn().mockResolvedValue([11, 12]),
    };
    gateway = {
      notifyNewAssignedOrder: jest.fn(),
      notifyNewOrderToArea: jest.fn(),
    };

    orderService = new OrderService(
      prisma as unknown as PrismaService,
      gateway as unknown as NotificationsGateway,
      {} as unknown as AreaVisibilityService,
      { ensureExists: jest.fn() } as unknown as OrderProductPresetService,
      notificationService as unknown as NotificationService,
      { record: jest.fn() } as unknown as AuditLogService,
      {
        findByOrder: jest.fn().mockResolvedValue([{ area: 'bordado' }]),
        createTasksForAreas: jest.fn().mockResolvedValue([]),
      } as unknown as OrderAreaTaskService,
    );
  });

  /** Datos enviados al `designRevision.create` dentro de la transacción. */
  const createdRevisionData = () =>
    prisma.designRevision.create.mock.calls.at(-1)?.[0].data;

  describe('createDesignRevision', () => {
    it('notifica SÓLO a la recepcionista que creó el pedido', async () => {
      await orderService.createDesignRevision(
        1,
        { montageFile: pngFile('a.png') },
        designer,
      );

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: CREATOR_USER_ID,
          type: 'design_montage_sent',
          orderId: 1,
        }),
      );
      expect(gateway.notifyNewAssignedOrder).toHaveBeenCalledWith(
        CREATOR_USER_ID,
        expect.objectContaining({ orderId: 1 }),
      );
    });

    it('no hace broadcast al área recepción', async () => {
      await orderService.createDesignRevision(
        1,
        { montageFile: pngFile('a.png') },
        designer,
      );

      expect(gateway.notifyNewOrderToArea).not.toHaveBeenCalled();
      expect(
        notificationService.createNotificationForUsers,
      ).not.toHaveBeenCalled();
    });

    it('guarda varios archivos de montaje en una sola ronda', async () => {
      await orderService.createDesignRevision(
        1,
        { montageFiles: [pngFile('a.png'), pngFile('b.png')] },
        designer,
      );

      const data = createdRevisionData();
      expect(data.files.create).toEqual([
        expect.objectContaining({
          kind: 'montage',
          filename: 'a.png',
          position: 0,
        }),
        expect.objectContaining({
          kind: 'montage',
          filename: 'b.png',
          position: 1,
        }),
      ]);
    });

    it('sigue poblando los campos legacy con el PRIMER archivo', async () => {
      await orderService.createDesignRevision(
        1,
        { montageFiles: [pngFile('primero.png'), pngFile('segundo.png')] },
        designer,
      );

      expect(createdRevisionData()).toEqual(
        expect.objectContaining({
          montageFileName: 'primero.png',
          montageFileMime: 'image/png',
        }),
      );
    });

    it('expone montageFiles en la respuesta, además de los campos legacy', async () => {
      const result: any = await orderService.createDesignRevision(
        1,
        { montageFiles: [pngFile('a.png'), pngFile('b.png')] },
        designer,
      );

      expect(result.montageFiles).toEqual([
        { id: 500, filename: 'a.png', mimeType: 'image/png' },
        { id: 501, filename: 'b.png', mimeType: 'image/png' },
      ]);
      expect(result.feedbackFiles).toEqual([]);
      expect(result.hasMontageFile).toBe(true);
    });

    it('rechaza una ronda sin ningún archivo', async () => {
      await expect(
        orderService.createDesignRevision(1, {} as any, designer),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });

    it('valida el contenido real de CADA archivo, no sólo del primero', async () => {
      const fake = {
        data: Buffer.from('no soy una imagen').toString('base64'),
        filename: 'b.png',
        mimeType: 'image/png',
      };

      await expect(
        orderService.createDesignRevision(
          1,
          { montageFiles: [pngFile('a.png'), fake] },
          designer,
        ),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza si el total de la ronda supera el tope agregado', async () => {
      // 5 archivos de ~4.5MB cada uno: cada uno pasa, el total (22MB) no.
      // El tope agregado es 7MB (ver MAX_DESIGN_REVISION_TOTAL_BYTES).
      const big = Buffer.concat([
        Buffer.from(MINIMAL_PNG_BASE64, 'base64'),
        Buffer.alloc(4.5 * 1024 * 1024, 0),
      ]).toString('base64');
      const files = Array.from({ length: 5 }, (_, i) => ({
        data: big,
        filename: `f${i}.png`,
        mimeType: 'image/png',
      }));

      await expect(
        orderService.createDesignRevision(1, { montageFiles: files }, designer),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });
  });

  describe('tope agregado por ronda (7MB, alineado al body-parser)', () => {
    /** Archivo PNG válido de `mb` megabytes aproximados. */
    const bigPng = (mb: number, name: string) => ({
      data: Buffer.concat([
        Buffer.from(MINIMAL_PNG_BASE64, 'base64'),
        Buffer.alloc(mb * 1024 * 1024, 0),
      ]).toString('base64'),
      filename: name,
      mimeType: 'image/png',
    });

    it('rechaza 2 archivos de 4MB (8MB > 7MB) aunque cada uno pase solo', async () => {
      await expect(
        orderService.createDesignRevision(
          1,
          { montageFiles: [bigPng(4, 'a.png'), bigPng(4, 'b.png')] },
          designer,
        ),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });

    it('acepta 2 archivos de 3MB (6MB < 7MB)', async () => {
      await expect(
        orderService.createDesignRevision(
          1,
          { montageFiles: [bigPng(3, 'a.png'), bigPng(3, 'b.png')] },
          designer,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('legacy + array a la vez', () => {
    it('rechaza montageFile y montageFiles juntos en vez de perder el legacy', async () => {
      await expect(
        orderService.createDesignRevision(
          1,
          {
            montageFile: pngFile('legacy.png'),
            montageFiles: [pngFile('a.png'), pngFile('b.png')],
          },
          designer,
        ),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza feedbackFile y feedbackFiles juntos', async () => {
      await expect(
        orderService.addDesignFeedback(
          1,
          100,
          {
            feedbackText: 'ver adjuntos',
            feedbackFile: pngFile('legacy.png'),
            feedbackFiles: [pngFile('a.png')],
          },
          receptionist,
        ),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('desarchivado al volver a Diseño', () => {
    /** Datos del `order.update` que corre dentro de la transacción. */
    const lastOrderUpdateData = () =>
      prisma.order.update.mock.calls.at(-1)?.[0].data;

    it('addDesignFeedback desarchiva el pedido', async () => {
      await orderService.addDesignFeedback(
        1,
        100,
        { feedbackText: 'cambiar el color' },
        receptionist,
      );

      expect(lastOrderUpdateData()).toMatchObject({
        area: 'diseno',
        archivedAt: null,
      });
    });

    it('createDesignRevision desarchiva el pedido', async () => {
      await orderService.createDesignRevision(
        1,
        { montageFile: pngFile('a.png') },
        designer,
      );

      expect(lastOrderUpdateData()).toMatchObject({ archivedAt: null });
    });

    it('update() con requiresDesign:true desarchiva el pedido', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 1,
        area: 'bordado',
        assignedUserId: null,
        userId: CREATOR_USER_ID,
        productionArea: 'bordado',
        requiresDesign: false,
        statusId: 9,
        status: { id: 9, name: 'autorizado' },
        description: 'algo',
        deliveryDate: null,
        clientId: 1,
        clientNameOverride: null,
      });
      prisma.order.update.mockResolvedValue({
        id: 1,
        status: { id: 9, name: 'autorizado' },
      });

      await orderService.update(
        1,
        { requiresDesign: true },
        receptionist.userId,
        receptionist,
      );

      expect(lastOrderUpdateData()).toMatchObject({
        requiresDesign: true,
        archivedAt: null,
      });
    });

    it('update() con requiresDesign:false NO toca archivedAt', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 1,
        area: 'bordado',
        assignedUserId: null,
        userId: CREATOR_USER_ID,
        productionArea: 'bordado',
        requiresDesign: true,
        statusId: 9,
        status: { id: 9, name: 'autorizado' },
        description: 'algo',
        deliveryDate: null,
        clientId: 1,
        clientNameOverride: null,
      });
      prisma.order.update.mockResolvedValue({
        id: 1,
        status: { id: 9, name: 'autorizado' },
      });

      await orderService.update(
        1,
        { requiresDesign: false },
        receptionist.userId,
        receptionist,
      );

      expect(lastOrderUpdateData()).not.toHaveProperty('archivedAt');
    });
  });

  describe('addDesignFeedback', () => {
    beforeEach(() => {
      prisma.designRevision.findUnique.mockResolvedValue({
        id: 100,
        orderId: 1,
        round: 1,
        sentByUserId: 5,
        montageFileName: 'a.png',
        feedbackFileName: null,
        files: [],
      });
      prisma.$transaction.mockResolvedValue([{ id: 100 }]);
    });

    it('notifica al diseñador de esa ronda, no a todo el área', async () => {
      await orderService.addDesignFeedback(
        1,
        100,
        { feedbackText: 'cambiar el logo' },
        receptionist,
      );

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 5, type: 'design_feedback_added' }),
      );
      expect(
        notificationService.createNotificationForUsers,
      ).not.toHaveBeenCalled();
      expect(gateway.notifyNewOrderToArea).not.toHaveBeenCalled();
    });

    it('si la ronda no tiene diseñador, cae al aviso por área', async () => {
      prisma.designRevision.findUnique.mockResolvedValue({
        id: 100,
        orderId: 1,
        round: 1,
        sentByUserId: null,
        montageFileName: 'a.png',
        feedbackFileName: null,
        files: [],
      });

      await orderService.addDesignFeedback(
        1,
        100,
        { feedbackText: 'cambiar el logo' },
        receptionist,
      );

      expect(
        notificationService.createNotificationForUsers,
      ).toHaveBeenCalledWith(
        [11, 12],
        expect.objectContaining({ type: 'design_feedback_added' }),
      );
      expect(gateway.notifyNewOrderToArea).toHaveBeenCalledWith(
        'diseno',
        expect.anything(),
      );
    });

    it('acepta varios archivos de feedback y deja el primero en los campos legacy', async () => {
      await orderService.addDesignFeedback(
        1,
        100,
        {
          feedbackText: 'ver adjuntos',
          feedbackFiles: [pngFile('uno.png'), pngFile('dos.png')],
        },
        receptionist,
      );

      const data = prisma.designRevision.update.mock.calls.at(-1)?.[0].data;
      expect(data.feedbackFileName).toBe('uno.png');
      expect(data.files.create).toHaveLength(2);
      expect(data.files.create[1]).toEqual(
        expect.objectContaining({ kind: 'feedback', position: 1 }),
      );
    });
  });

  describe('approveDesignRevision', () => {
    it('archiva el pedido (archivedAt) al autorizar', async () => {
      await orderService.approveDesignRevision(1, 100, {}, receptionist);

      const orderUpdate = prisma.order.update.mock.calls.at(-1)?.[0];
      expect(orderUpdate.data.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe('getDesignRevisionFile', () => {
    it('devuelve el archivo pedido con la misma forma que el endpoint viejo', async () => {
      prisma.designRevisionFile.findUnique.mockResolvedValue({
        id: 501,
        revisionId: 100,
        filename: 'b.png',
        mimeType: 'image/png',
        data: MINIMAL_PNG_BASE64,
      });

      const result = await orderService.getDesignRevisionFile(
        1,
        100,
        501,
        designer,
      );

      expect(result).toEqual({
        filename: 'b.png',
        mimeType: 'image/png',
        dataUrl: `data:image/png;base64,${MINIMAL_PNG_BASE64}`,
      });
    });

    it('404 si el archivo es de otra ronda', async () => {
      prisma.designRevisionFile.findUnique.mockResolvedValue({
        id: 501,
        revisionId: 999,
        filename: 'b.png',
        mimeType: 'image/png',
        data: MINIMAL_PNG_BASE64,
      });

      await expect(
        orderService.getDesignRevisionFile(1, 100, 501, designer),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });
  });
});
