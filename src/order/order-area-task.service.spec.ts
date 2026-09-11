import { AreaTaskStatus } from '@prisma/client';
import { BadRequestException, HttpException } from '@nestjs/common';
import { OrderAreaTaskService } from './order-area-task.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from 'src/notification/notification.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';

/** Estado global "terminado" = listo para entregar (ver WORKFLOW.md §3). */
const READY_FOR_DELIVERY_STATUS_ID = 4;

describe('OrderAreaTaskService', () => {
  let service: OrderAreaTaskService;
  let prisma: {
    orderAreaTask: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    order: { findUnique: jest.Mock; update: jest.Mock };
    orderHistory: { create: jest.Mock };
    status: { findUnique: jest.Mock };
    user: { findFirst: jest.Mock; findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let notificationService: {
    userIdsForArea: jest.Mock;
    createNotificationForUsers: jest.Mock;
    createNotification: jest.Mock;
  };
  let gateway: { notifyNewOrderToArea: jest.Mock };

  beforeEach(() => {
    prisma = {
      orderAreaTask: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn((args: { data: unknown }) => ({
          id: 1,
          ...(args.data as object),
        })),
        update: jest.fn((args: { data: unknown }) => ({
          id: 1,
          ...(args.data as object),
        })),
        delete: jest.fn(),
      },
      order: { findUnique: jest.fn(), update: jest.fn() },
      orderHistory: { create: jest.fn() },
      status: { findUnique: jest.fn().mockResolvedValue({ id: 9 }) },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    notificationService = {
      userIdsForArea: jest.fn().mockResolvedValue([7]),
      createNotificationForUsers: jest.fn().mockResolvedValue(undefined),
      createNotification: jest.fn().mockResolvedValue(undefined),
    };
    gateway = { notifyNewOrderToArea: jest.fn() };

    service = new OrderAreaTaskService(
      prisma as unknown as PrismaService,
      notificationService as unknown as NotificationService,
      gateway as unknown as NotificationsGateway,
    );
  });

  describe('createTasksForAreas', () => {
    it('asigna cada tarea a la cuenta compartida de su área', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 42 });

      await service.createTasksForAreas(1, ['bordado']);

      expect(prisma.orderAreaTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { orderId: 1, area: 'bordado', assignedUserId: 42 },
        }),
      );
    });

    it('no duplica un área que el pedido ya tiene', async () => {
      prisma.orderAreaTask.findMany.mockResolvedValue([{ area: 'bordado' }]);

      await service.createTasksForAreas(1, ['bordado', 'dtf']);

      expect(prisma.orderAreaTask.create).toHaveBeenCalledTimes(1);
      expect(prisma.orderAreaTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ area: 'dtf' }),
        }),
      );
    });

    it('notifica sólo al área de cada tarea', async () => {
      await service.createTasksForAreas(1, ['laser']);

      expect(notificationService.userIdsForArea).toHaveBeenCalledWith('laser');
      expect(gateway.notifyNewOrderToArea).toHaveBeenCalledWith(
        'laser',
        expect.objectContaining({ area: 'laser', orderId: 1 }),
      );
    });

    it('con notify:false no avisa (áreas planificadas antes del montaje)', async () => {
      await service.createTasksForAreas(1, ['dtf'], { notify: false });

      expect(gateway.notifyNewOrderToArea).not.toHaveBeenCalled();
      expect(
        notificationService.createNotificationForUsers,
      ).not.toHaveBeenCalled();
    });

    it('rechaza "diseno" como área de producción', async () => {
      await expect(service.createTasksForAreas(1, ['diseno'])).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('updateStatus', () => {
    const manager = { userId: 1, roles: ['recepcion'] };

    beforeEach(() => {
      // La tarea ya está en curso: el ciclo sólo avanza de a un paso, así que
      // para terminarla tiene que venir de `en_proceso`.
      prisma.orderAreaTask.findUnique.mockResolvedValue({
        id: 10,
        orderId: 5,
        area: 'bordado',
        status: AreaTaskStatus.en_proceso,
        assignedUserId: null,
      });
    });

    it('deja el pedido listo para entregar cuando todas las áreas terminaron', async () => {
      prisma.orderAreaTask.findMany.mockResolvedValue([
        { status: AreaTaskStatus.terminado },
        { status: AreaTaskStatus.terminado },
      ]);
      prisma.order.findUnique.mockResolvedValue({ statusId: 3 });

      await service.updateStatus(10, AreaTaskStatus.terminado, manager);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { statusId: READY_FOR_DELIVERY_STATUS_ID },
        }),
      );
    });

    it('no toca el pedido si todavía hay áreas sin terminar', async () => {
      prisma.orderAreaTask.findMany.mockResolvedValue([
        { status: AreaTaskStatus.terminado },
        { status: AreaTaskStatus.en_proceso },
      ]);

      await service.updateStatus(10, AreaTaskStatus.terminado, manager);

      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('nunca marca el pedido como entregado por su cuenta', async () => {
      prisma.orderAreaTask.findMany.mockResolvedValue([
        { status: AreaTaskStatus.terminado },
      ]);
      prisma.order.findUnique.mockResolvedValue({ statusId: 3 });

      await service.updateStatus(10, AreaTaskStatus.terminado, manager);

      const updates = prisma.order.update.mock.calls.map(
        (call: [{ data: { statusId: number } }]) => call[0].data.statusId,
      );
      expect(updates).not.toContain(5);
    });

    it('no revive un pedido ya entregado', async () => {
      prisma.orderAreaTask.findMany.mockResolvedValue([
        { status: AreaTaskStatus.terminado },
      ]);
      prisma.order.findUnique.mockResolvedValue({ statusId: 5 });

      await service.updateStatus(10, AreaTaskStatus.terminado, manager);

      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('rechaza a alguien de otra área', async () => {
      await expect(
        service.updateStatus(10, AreaTaskStatus.terminado, {
          userId: 2,
          roles: ['dtf'],
        }),
      ).rejects.toThrow(HttpException);
    });

    it('permite avanzar a alguien del área de la tarea', async () => {
      await expect(
        service.updateStatus(10, AreaTaskStatus.terminado, {
          userId: 2,
          roles: ['bordado'],
        }),
      ).resolves.toBeDefined();
    });

    describe('transiciones válidas', () => {
      const setTaskStatus = (status: AreaTaskStatus) =>
        prisma.orderAreaTask.findUnique.mockResolvedValue({
          id: 10,
          orderId: 5,
          area: 'bordado',
          status,
          assignedUserId: null,
        });

      it('rechaza saltar de pendiente a terminado', async () => {
        setTaskStatus(AreaTaskStatus.pendiente);

        await expect(
          service.updateStatus(10, AreaTaskStatus.terminado, manager),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.orderAreaTask.update).not.toHaveBeenCalled();
      });

      it('rechaza volver de terminado a pendiente', async () => {
        setTaskStatus(AreaTaskStatus.terminado);

        await expect(
          service.updateStatus(10, AreaTaskStatus.pendiente, manager),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it.each([
        [AreaTaskStatus.pendiente, AreaTaskStatus.en_proceso],
        [AreaTaskStatus.en_proceso, AreaTaskStatus.terminado],
        [AreaTaskStatus.en_proceso, AreaTaskStatus.pendiente],
        [AreaTaskStatus.terminado, AreaTaskStatus.en_proceso],
      ])('permite %s → %s', async (from, to) => {
        setTaskStatus(from);

        await expect(
          service.updateStatus(10, to, manager),
        ).resolves.toBeDefined();
      });
    });

    describe('tomar la tarea al empezarla (WORKFLOW.md §3)', () => {
      const worker = { userId: 33, roles: ['bordado'] };
      const pendingTask = (assignedUserId: number | null) =>
        prisma.orderAreaTask.findUnique.mockResolvedValue({
          id: 10,
          orderId: 5,
          area: 'bordado',
          status: AreaTaskStatus.pendiente,
          assignedUserId,
        });

      it('se la asigna a quien la arranca si estaba sin asignar', async () => {
        pendingTask(null);

        await service.updateStatus(10, AreaTaskStatus.en_proceso, worker);

        expect(prisma.orderAreaTask.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ assignedUserId: 33 }),
          }),
        );
      });

      it('se la saca a la cuenta compartida del área', async () => {
        pendingTask(42);
        prisma.user.findFirst.mockResolvedValue({ id: 42 }); // cuenta de área

        await service.updateStatus(10, AreaTaskStatus.en_proceso, worker);

        expect(prisma.orderAreaTask.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ assignedUserId: 33 }),
          }),
        );
      });

      it('no le roba la tarea a otra persona que ya la tenía', async () => {
        pendingTask(7); // una persona concreta, no la cuenta de área
        prisma.user.findFirst.mockResolvedValue({ id: 42 });

        await service.updateStatus(10, AreaTaskStatus.en_proceso, worker);

        const data = prisma.orderAreaTask.update.mock.calls.at(-1)?.[0]
          .data as Record<string, unknown>;
        expect(data).not.toHaveProperty('assignedUserId');
      });

      it('no reasigna al terminar, sólo al empezar', async () => {
        prisma.orderAreaTask.findUnique.mockResolvedValue({
          id: 10,
          orderId: 5,
          area: 'bordado',
          status: AreaTaskStatus.en_proceso,
          assignedUserId: null,
        });

        await service.updateStatus(10, AreaTaskStatus.terminado, worker);

        const data = prisma.orderAreaTask.update.mock.calls.at(-1)?.[0]
          .data as Record<string, unknown>;
        expect(data).not.toHaveProperty('assignedUserId');
      });
    });

    describe('notificaciones dirigidas al creador del pedido', () => {
      beforeEach(() => {
        prisma.order.findUnique.mockImplementation(
          (args: { select?: Record<string, boolean> }) =>
            args.select?.userId ? { userId: 77 } : { statusId: 3, userId: 77 },
        );
      });

      it('avisa del área terminada SÓLO a quien creó el pedido', async () => {
        prisma.orderAreaTask.findMany.mockResolvedValue([
          { status: AreaTaskStatus.terminado },
          { status: AreaTaskStatus.en_proceso },
        ]);

        await service.updateStatus(10, AreaTaskStatus.terminado, manager);

        expect(notificationService.createNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 77,
            type: 'area_task_completed',
            orderId: 5,
          }),
        );
        expect(
          notificationService.createNotificationForUsers,
        ).not.toHaveBeenCalled();
      });

      it('avisa "listo para entregar" SÓLO a quien creó el pedido', async () => {
        prisma.orderAreaTask.findMany.mockResolvedValue([
          { status: AreaTaskStatus.terminado },
        ]);

        await service.updateStatus(10, AreaTaskStatus.terminado, manager);

        const types = notificationService.createNotification.mock.calls.map(
          (call: [{ type: string; userId: number }]) => call[0],
        );
        expect(types).toContainEqual(
          expect.objectContaining({ userId: 77, type: 'order_ready' }),
        );
        expect(
          notificationService.createNotificationForUsers,
        ).not.toHaveBeenCalled();
      });
    });

    describe('retroceso desde terminado', () => {
      beforeEach(() => {
        prisma.orderAreaTask.findUnique.mockResolvedValue({
          id: 10,
          orderId: 5,
          area: 'bordado',
          status: AreaTaskStatus.terminado,
          assignedUserId: null,
        });
        prisma.orderAreaTask.findMany.mockResolvedValue([
          { status: AreaTaskStatus.en_proceso },
        ]);
      });

      it('devuelve el pedido a "autorizado" si ya estaba listo para entregar', async () => {
        prisma.order.findUnique.mockResolvedValue({
          statusId: READY_FOR_DELIVERY_STATUS_ID,
          userId: 77,
        });

        await service.updateStatus(10, AreaTaskStatus.en_proceso, manager);

        expect(prisma.order.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { statusId: 9 } }),
        );
      });

      it('no toca el pedido si todavía no estaba listo para entregar', async () => {
        prisma.order.findUnique.mockResolvedValue({
          statusId: 3,
          userId: 77,
        });

        await service.updateStatus(10, AreaTaskStatus.en_proceso, manager);

        expect(prisma.order.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('findForUser', () => {
    it('un empleado ve sólo las tareas de sus propias áreas', async () => {
      await service.findForUser({ userId: 3, roles: ['bordado', 'laser'] });

      expect(prisma.orderAreaTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            area: { in: ['bordado', 'laser'] },
          }),
        }),
      );
    });

    it('Recepción ve las tareas de todas las áreas', async () => {
      await service.findForUser({ userId: 1, roles: ['recepcion'] });

      const args = prisma.orderAreaTask.findMany.mock.calls.at(-1)?.[0] as {
        where: Record<string, unknown>;
      };
      expect(args.where).not.toHaveProperty('area');
    });

    it('deja fuera los pedidos entregados y cancelados', async () => {
      await service.findForUser({ userId: 3, roles: ['dtf'] });

      expect(prisma.orderAreaTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            order: { statusId: { notIn: [5, 10] } },
          }),
        }),
      );
    });

    it('sin áreas de producción ni gestión, no hay bandeja', async () => {
      const result = await service.findForUser({
        userId: 4,
        roles: ['diseno'],
      });

      expect(result).toEqual([]);
    });
  });

  describe('assign', () => {
    beforeEach(() => {
      prisma.orderAreaTask.findUnique.mockResolvedValue({
        id: 10,
        area: 'bordado',
      });
      prisma.user.findUnique.mockResolvedValue({
        roles: [{ name: 'bordado' }],
      });
    });

    it('deja que alguien del área se tome la tarea', async () => {
      await expect(
        service.assign(10, 3, { userId: 3, roles: ['bordado'] }),
      ).resolves.toBeDefined();
    });

    it('impide asignarle la tarea a otra persona sin ser Recepción', async () => {
      await expect(
        service.assign(10, 99, { userId: 3, roles: ['bordado'] }),
      ).rejects.toThrow(HttpException);
    });

    it('rechaza a un usuario que no pertenece al área', async () => {
      prisma.user.findUnique.mockResolvedValue({ roles: [{ name: 'dtf' }] });

      await expect(
        service.assign(10, 99, { userId: 1, roles: ['recepcion'] }),
      ).rejects.toThrow(HttpException);
    });
  });
});
