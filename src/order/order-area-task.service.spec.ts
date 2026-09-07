import { AreaTaskStatus } from '@prisma/client';
import { HttpException } from '@nestjs/common';
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
    user: { findFirst: jest.Mock; findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let notificationService: {
    userIdsForArea: jest.Mock;
    createNotificationForUsers: jest.Mock;
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
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    notificationService = {
      userIdsForArea: jest.fn().mockResolvedValue([7]),
      createNotificationForUsers: jest.fn().mockResolvedValue(undefined),
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
      prisma.orderAreaTask.findUnique.mockResolvedValue({
        id: 10,
        orderId: 5,
        area: 'bordado',
        status: AreaTaskStatus.pendiente,
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
        service.updateStatus(10, AreaTaskStatus.en_proceso, {
          userId: 2,
          roles: ['dtf'],
        }),
      ).rejects.toThrow(HttpException);
    });

    it('permite avanzar a alguien del área de la tarea', async () => {
      await expect(
        service.updateStatus(10, AreaTaskStatus.en_proceso, {
          userId: 2,
          roles: ['bordado'],
        }),
      ).resolves.toBeDefined();
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
