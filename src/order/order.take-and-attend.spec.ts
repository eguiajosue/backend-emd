import { HttpException } from '@nestjs/common';
import { AreaTaskStatus } from '@prisma/client';
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

/** Recepcionista que dio de alta el pedido: `Order.userId`, no cambia nunca. */
const CREATOR_USER_ID = 77;
/** Recepcionista que TOMÓ el pedido (está de guardia hoy). */
const ATTENDING_USER_ID = 88;
/** Cuenta compartida del área Diseño ("Cualquier diseñador"). */
const DESIGN_SHARED_ACCOUNT_ID = 42;

const designer: RequestingUser = { userId: 5, roles: ['diseno'] };
const otherDesigner: RequestingUser = { userId: 6, roles: ['diseno'] };

type OrderRow = {
  id: number;
  area: string | null;
  assignedUserId: number | null;
  userId: number;
  attendedByUserId: number | null;
  assignedUser?: {
    id: number;
    isSharedAccount: boolean;
    roles: { name: string }[];
  } | null;
};

const buildOrderService = (
  prisma: unknown,
  overrides: {
    notificationService?: unknown;
    gateway?: unknown;
    areaTaskService?: unknown;
    presetService?: unknown;
  } = {},
) =>
  new OrderService(
    prisma as PrismaService,
    (overrides.gateway ?? {}) as NotificationsGateway,
    {} as AreaVisibilityService,
    (overrides.presetService ?? {
      ensureExists: jest.fn(),
    }) as OrderProductPresetService,
    (overrides.notificationService ?? {
      createNotification: jest.fn(),
      createNotificationForUsers: jest.fn(),
      userIdsForArea: jest.fn().mockResolvedValue([]),
    }) as NotificationService,
    { record: jest.fn() } as unknown as AuditLogService,
    (overrides.areaTaskService ?? {
      createTasksForAreas: jest.fn().mockResolvedValue([]),
    }) as OrderAreaTaskService,
  );

/**
 * Prisma mockeado para los endpoints de "tomar": una sola fila de pedido
 * sirve para las tres lecturas que hace el servicio (control de acceso,
 * estado actual de la asignación y relectura para la respuesta).
 */
const makePrisma = (order: OrderRow) => ({
  order: {
    findUnique: jest.fn().mockResolvedValue(order),
    update: jest.fn().mockResolvedValue(order),
  },
  user: {
    findUnique: jest.fn().mockResolvedValue({
      id: designer.userId,
      roles: [{ name: 'diseno' }],
    }),
  },
  orderAuditLog: { create: jest.fn() },
  // $transaction con array de operaciones: acá ya vienen resueltas.
  $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
});

describe('Recepción: atender un pedido ajeno (WORKFLOW.md §2)', () => {
  describe('POST /orders/:id/take-reception', () => {
    const receptionist: RequestingUser = {
      userId: ATTENDING_USER_ID,
      roles: ['recepcion'],
    };

    it('deja registrado quién lo atiende sin tocar al creador', async () => {
      const prisma = makePrisma({
        id: 1,
        area: 'diseno',
        assignedUserId: null,
        userId: CREATOR_USER_ID,
        attendedByUserId: null,
      });
      const service = buildOrderService(prisma);

      await service.takeReception(1, receptionist);

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { attendedBy: { connect: { id: ATTENDING_USER_ID } } },
        }),
      );
      // `userId` (creador) no aparece en el update: no se pisa nunca.
      const data = prisma.order.update.mock.calls.at(-1)?.[0].data;
      expect(data).not.toHaveProperty('user');
      expect(data).not.toHaveProperty('userId');
    });

    it('deja rastro en la auditoría del pedido', async () => {
      const prisma = makePrisma({
        id: 1,
        area: 'diseno',
        assignedUserId: null,
        userId: CREATOR_USER_ID,
        attendedByUserId: null,
      });
      const service = buildOrderService(prisma);

      await service.takeReception(1, receptionist);

      expect(prisma.orderAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'reception_taken',
            changes: {
              attendedByUserId: {
                before: null,
                after: ATTENDING_USER_ID,
              },
            },
          }),
        }),
      );
    });

    it('es idempotente: tomarlo de nuevo no falla ni reescribe', async () => {
      const prisma = makePrisma({
        id: 1,
        area: 'diseno',
        assignedUserId: null,
        userId: CREATOR_USER_ID,
        attendedByUserId: ATTENDING_USER_ID,
      });
      const service = buildOrderService(prisma);

      await expect(
        service.takeReception(1, receptionist),
      ).resolves.toBeDefined();
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.orderAuditLog.create).not.toHaveBeenCalled();
    });

    it('se lo puede sacar a otra recepcionista que lo estaba atendiendo', async () => {
      const prisma = makePrisma({
        id: 1,
        area: 'diseno',
        assignedUserId: null,
        userId: CREATOR_USER_ID,
        attendedByUserId: 99,
      });
      const service = buildOrderService(prisma);

      await service.takeReception(1, receptionist);

      expect(prisma.orderAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            changes: {
              attendedByUserId: { before: 99, after: ATTENDING_USER_ID },
            },
          }),
        }),
      );
    });
  });

  describe('destinatario efectivo de los avisos (createDesignRevision)', () => {
    const buildForRevision = (attendedByUserId: number | null) => {
      const prisma = {
        order: {
          findUnique: jest.fn().mockResolvedValue({
            id: 1,
            area: 'diseno',
            assignedUserId: null,
            userId: CREATOR_USER_ID,
            attendedByUserId,
          }),
          update: jest.fn(),
        },
        designRevision: {
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn().mockResolvedValue({
            id: 100,
            orderId: 1,
            round: 1,
            files: [],
          }),
          create: jest.fn(),
        },
        orderAuditLog: { create: jest.fn() },
        status: { findUnique: jest.fn().mockResolvedValue({ id: 9 }) },
        $transaction: jest.fn().mockResolvedValue([{ id: 100 }]),
      };
      const notificationService = {
        createNotification: jest.fn().mockResolvedValue(undefined),
        createNotificationForUsers: jest.fn().mockResolvedValue(undefined),
        userIdsForArea: jest.fn().mockResolvedValue([]),
      };
      const gateway = {
        notifyNewAssignedOrder: jest.fn(),
        notifyNewOrderToArea: jest.fn(),
      };
      return {
        service: buildOrderService(prisma, { notificationService, gateway }),
        notificationService,
        gateway,
      };
    };

    const montage = {
      montageFile: {
        data: MINIMAL_PNG_BASE64,
        filename: 'a.png',
        mimeType: 'image/png',
      },
    };

    it('sin attendedByUserId: avisa a quien creó el pedido', async () => {
      const { service, notificationService, gateway } = buildForRevision(null);

      await service.createDesignRevision(1, montage, designer);

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: CREATOR_USER_ID,
          type: 'design_montage_sent',
        }),
      );
      expect(gateway.notifyNewAssignedOrder).toHaveBeenCalledWith(
        CREATOR_USER_ID,
        expect.anything(),
      );
    });

    it('con attendedByUserId: avisa a quien lo está atendiendo, no al creador', async () => {
      const { service, notificationService, gateway } =
        buildForRevision(ATTENDING_USER_ID);

      await service.createDesignRevision(1, montage, designer);

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: ATTENDING_USER_ID,
          type: 'design_montage_sent',
        }),
      );
      expect(notificationService.createNotification).not.toHaveBeenCalledWith(
        expect.objectContaining({ userId: CREATOR_USER_ID }),
      );
      expect(gateway.notifyNewAssignedOrder).toHaveBeenCalledWith(
        ATTENDING_USER_ID,
        expect.anything(),
      );
    });

    it('quien atiende el pedido no recibe aviso de su propia acción', async () => {
      const { service, notificationService } = buildForRevision(
        designer.userId,
      );

      await service.createDesignRevision(1, montage, designer);

      expect(notificationService.createNotification).not.toHaveBeenCalled();
    });
  });
});

describe('OrderAreaTaskService: destinatario efectivo de los avisos a Recepción', () => {
  const buildAreaTaskService = (attendedByUserId: number | null) => {
    const prisma = {
      orderAreaTask: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10,
          orderId: 5,
          area: 'bordado',
          status: AreaTaskStatus.en_proceso,
          assignedUserId: null,
        }),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { status: AreaTaskStatus.terminado },
            { status: AreaTaskStatus.en_proceso },
          ]),
        update: jest.fn().mockResolvedValue({ id: 10 }),
      },
      order: {
        findUnique: jest.fn((args: { select?: Record<string, boolean> }) =>
          args.select?.attendedByUserId
            ? { userId: CREATOR_USER_ID, attendedByUserId }
            : { statusId: 3 },
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderHistory: { create: jest.fn() },
      status: {
        findUnique: jest.fn().mockResolvedValue({ id: 4 }),
      },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(prisma)
          : arg,
      ),
    };
    const notificationService = {
      createNotification: jest.fn().mockResolvedValue(undefined),
      createNotificationForUsers: jest.fn().mockResolvedValue(undefined),
      userIdsForArea: jest.fn().mockResolvedValue([]),
    };
    const service = new OrderAreaTaskService(
      prisma as unknown as PrismaService,
      notificationService as unknown as NotificationService,
      { notifyNewOrderToArea: jest.fn() } as unknown as NotificationsGateway,
    );
    return { service, notificationService };
  };

  const worker: RequestingUser = { userId: 33, roles: ['bordado'] };

  it('sin attendedByUserId: el aviso de etapa terminada va al creador', async () => {
    const { service, notificationService } = buildAreaTaskService(null);

    await service.updateStatus(10, AreaTaskStatus.terminado, worker);

    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: CREATOR_USER_ID,
        type: 'area_task_completed',
      }),
    );
  });

  it('con attendedByUserId: el aviso va a quien atiende el pedido', async () => {
    const { service, notificationService } =
      buildAreaTaskService(ATTENDING_USER_ID);

    await service.updateStatus(10, AreaTaskStatus.terminado, worker);

    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ATTENDING_USER_ID,
        type: 'area_task_completed',
      }),
    );
    expect(notificationService.createNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: CREATOR_USER_ID }),
    );
  });
});

describe('Diseño: tomar un pedido de la cuenta compartida (WORKFLOW.md §1.a)', () => {
  const sharedAccountOrder = (): OrderRow => ({
    id: 1,
    area: 'diseno',
    assignedUserId: DESIGN_SHARED_ACCOUNT_ID,
    userId: CREATOR_USER_ID,
    attendedByUserId: null,
    assignedUser: {
      id: DESIGN_SHARED_ACCOUNT_ID,
      isSharedAccount: true,
      roles: [{ name: 'diseno' }],
    },
  });

  it('toma el pedido que estaba en la cuenta compartida del área', async () => {
    const prisma = makePrisma(sharedAccountOrder());
    const service = buildOrderService(prisma);

    await service.takeDesign(1, designer);

    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { assignedUser: { connect: { id: designer.userId } } },
      }),
    );
    expect(prisma.orderAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'design_taken',
          changes: {
            assignedUserId: {
              before: DESIGN_SHARED_ACCOUNT_ID,
              after: designer.userId,
            },
          },
        }),
      }),
    );
  });

  it('toma el pedido que estaba sin asignar', async () => {
    const prisma = makePrisma({
      id: 1,
      area: 'diseno',
      assignedUserId: null,
      userId: CREATOR_USER_ID,
      attendedByUserId: null,
      assignedUser: null,
    });
    const service = buildOrderService(prisma);

    await service.takeDesign(1, designer);

    expect(prisma.order.update).toHaveBeenCalled();
  });

  it('NO se lo roba a otro diseñador: 400 con mensaje claro', async () => {
    const prisma = makePrisma({
      id: 1,
      area: 'diseno',
      assignedUserId: otherDesigner.userId,
      userId: CREATOR_USER_ID,
      attendedByUserId: null,
      assignedUser: {
        id: otherDesigner.userId,
        isSharedAccount: false,
        roles: [{ name: 'diseno' }],
      },
    });
    const service = buildOrderService(prisma);

    await expect(service.takeDesign(1, designer)).rejects.toMatchObject({
      status: 400,
    });
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(prisma.orderAuditLog.create).not.toHaveBeenCalled();
  });

  it('es idempotente: si ya lo tenía quien llama, no reescribe ni falla', async () => {
    const prisma = makePrisma({
      id: 1,
      area: 'diseno',
      assignedUserId: designer.userId,
      userId: CREATOR_USER_ID,
      attendedByUserId: null,
      assignedUser: {
        id: designer.userId,
        isSharedAccount: false,
        roles: [{ name: 'diseno' }],
      },
    });
    const service = buildOrderService(prisma);

    await expect(service.takeDesign(1, designer)).resolves.toBeDefined();
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(prisma.orderAuditLog.create).not.toHaveBeenCalled();
  });

  it('rechaza a quien no pertenece al área Diseño', async () => {
    const prisma = makePrisma(sharedAccountOrder());
    prisma.user.findUnique.mockResolvedValue({
      id: 3,
      roles: [{ name: 'admin' }],
    });
    const service = buildOrderService(prisma);

    await expect(
      service.takeDesign(1, { userId: 3, roles: ['admin'] }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});

describe('Alta del pedido: archivo de recursos del cliente (rename)', () => {
  const clientResourceFile = {
    data: MINIMAL_PNG_BASE64,
    filename: 'logo-del-cliente.png',
    mimeType: 'image/png',
  };

  const buildForCreate = () => {
    const createdOrder = {
      id: 1,
      description: 'Remeras',
      clientNameOverride: 'Juan',
      creationDate: new Date(),
      deliveryDate: null,
      area: 'diseno',
      assignedUserId: designer.userId,
      user: { id: CREATOR_USER_ID, username: 'recepcion1' },
    };
    const prisma = {
      order: {
        create: jest.fn().mockResolvedValue(createdOrder),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: designer.userId,
          roles: [{ name: 'diseno' }],
        }),
      },
      status: { findUnique: jest.fn().mockResolvedValue({ id: 6 }) },
    };
    const notificationService = {
      createNotification: jest.fn().mockResolvedValue(undefined),
      createNotificationForUsers: jest.fn().mockResolvedValue(undefined),
      userIdsForArea: jest.fn().mockResolvedValue([]),
    };
    const service = buildOrderService(prisma, {
      notificationService,
      gateway: {
        notifyNewOrderToAdmin: jest.fn(),
        notifyNewAssignedOrder: jest.fn(),
        notifyNewOrderToArea: jest.fn(),
      },
    });
    return { service, prisma };
  };

  const baseDto = {
    userId: CREATOR_USER_ID,
    statusId: 1,
    description: 'Remeras',
    clientNameOverride: 'Juan',
    assignedUserId: designer.userId,
    requiresDesign: true,
    orderProducts: [{ customName: 'Remera', quantity: 1 }],
  };

  it('guarda el archivo del cliente en las columnas clientResourceFile*', async () => {
    const { service, prisma } = buildForCreate();

    await service.create({ ...baseDto, clientResourceFile });

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientResourceFileData: clientResourceFile.data,
          clientResourceFileName: 'logo-del-cliente.png',
          clientResourceFileMime: 'image/png',
        }),
      }),
    );
  });

  it('el archivo del cliente sigue siendo opcional', async () => {
    const { service, prisma } = buildForCreate();

    await service.create({ ...baseDto });

    const data = prisma.order.create.mock.calls.at(-1)?.[0].data;
    expect(data).not.toHaveProperty('clientResourceFileData');
  });

  it('valida el contenido real del archivo del cliente (magic bytes)', async () => {
    const { service, prisma } = buildForCreate();

    await expect(
      service.create({
        ...baseDto,
        clientResourceFile: {
          data: Buffer.from('no soy un png').toString('base64'),
          filename: 'trucho.png',
          mimeType: 'image/png',
        },
      }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });
});
