import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AreaTaskStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from 'src/notification/notification.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { Role } from 'src/common/enums/roles.enum';
import { PRODUCTION_AREAS } from './dto/create-order.dto';
import type { RequestingUser } from './order.service';

/**
 * Estado global al que pasa el pedido cuando TODAS sus áreas terminaron:
 * "terminado" = listo para entregar. La entrega (estado 5) la confirma
 * Recepción a mano, nunca automáticamente. Ver WORKFLOW.md §3.
 */
const READY_FOR_DELIVERY_STATUS_ID = 4;

/** Roles que pueden reasignar cualquier tarea (ver WORKFLOW.md §5). */
const TASK_MANAGER_ROLES: string[] = [
  Role.RECEPCION,
  Role.ADMIN,
  Role.SUPERUSER,
];

/**
 * Tareas de área de un pedido: el trabajo de producción partido por área,
 * avanzando en paralelo.
 *
 * Cada área lleva su propio estado (pendiente → en_proceso → terminado) y su
 * propio responsable, que por defecto es la cuenta compartida del área para
 * que cualquiera del área pueda tomarla.
 */
@Injectable()
export class OrderAreaTaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  /** Selección estándar de una tarea, con el responsable resumido. */
  private taskSelect() {
    return {
      id: true,
      orderId: true,
      area: true,
      status: true,
      assignedUserId: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      assignedUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          isSharedAccount: true,
        },
      },
    } satisfies Prisma.OrderAreaTaskSelect;
  }

  /**
   * Cuenta compartida de un área ("Área: Bordado"), usada como responsable por
   * defecto de sus tareas. Si el área no tiene una, la tarea queda sin asignar
   * y la toma quien la trabaje.
   */
  private async sharedAccountIdForArea(area: string): Promise<number | null> {
    const shared = await this.prisma.user.findFirst({
      where: { isSharedAccount: true, roles: { some: { name: area } } },
      select: { id: true },
    });
    return shared?.id ?? null;
  }

  private assertProductionArea(area: string): void {
    if (!(PRODUCTION_AREAS as readonly string[]).includes(area)) {
      throw new HttpException(
        `"${area}" no es un área de producción válida`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Crea las tareas de las áreas indicadas para un pedido, asignando cada una a
   * la cuenta compartida de su área y notificando SOLO a esa área.
   *
   * Idempotente: las áreas que ya tienen tarea en el pedido se ignoran, así se
   * puede llamar tanto al crear el pedido como al autorizar el montaje, o para
   * sumar un área a mitad de camino.
   */
  async createTasksForAreas(
    orderId: number,
    areas: string[],
    options?: { notify?: boolean },
  ) {
    const unique = [...new Set(areas)];
    unique.forEach((area) => this.assertProductionArea(area));

    const existing = await this.prisma.orderAreaTask.findMany({
      where: { orderId },
      select: { area: true },
    });
    const existingAreas = new Set(existing.map((t) => t.area));
    const toCreate = unique.filter((area) => !existingAreas.has(area));
    if (toCreate.length === 0) return [];

    const created = await Promise.all(
      toCreate.map(async (area) => {
        const assignedUserId = await this.sharedAccountIdForArea(area);
        return this.prisma.orderAreaTask.create({
          data: { orderId, area, assignedUserId },
          select: this.taskSelect(),
        });
      }),
    );

    if (options?.notify !== false) {
      await Promise.all(
        toCreate.map((area) => this.notifyAreaOfNewTask(orderId, area)),
      );
    }
    return created;
  }

  /** Aviso de tarea nueva, dirigido sólo al área que le toca (WORKFLOW.md §3). */
  private async notifyAreaOfNewTask(orderId: number, area: string) {
    const areaUserIds = await this.notificationService.userIdsForArea(area);
    await this.notificationService.createNotificationForUsers(areaUserIds, {
      type: 'area_task_created',
      title: `Nueva tarea de ${area}`,
      body: `Pedido #${orderId}: hay trabajo pendiente para ${area}`,
      orderId,
    });
    this.notificationsGateway.notifyNewOrderToArea(area, {
      orderId,
      description: `Nueva tarea de ${area} en el pedido #${orderId}`,
      area,
      deliveryDate: null,
    });
  }

  /** Tareas de un pedido, en orden de creación. */
  async findByOrder(orderId: number) {
    return this.prisma.orderAreaTask.findMany({
      where: { orderId },
      select: this.taskSelect(),
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Cambia el estado de una tarea y sincroniza el pedido:
   * - al pasar a `en_proceso` marca `startedAt`;
   * - al pasar a `terminado` marca `completedAt` y, si TODAS las áreas del
   *   pedido terminaron, lo deja "listo para entregar".
   */
  async updateStatus(
    taskId: number,
    status: AreaTaskStatus,
    requestingUser: RequestingUser,
  ) {
    const task = await this.prisma.orderAreaTask.findUnique({
      where: { id: taskId },
      select: { id: true, orderId: true, area: true, status: true },
    });
    if (!task) {
      throw new HttpException('La tarea no existe', HttpStatus.NOT_FOUND);
    }
    this.assertCanWorkArea(task.area, requestingUser);

    const now = new Date();
    const updated = await this.prisma.orderAreaTask.update({
      where: { id: taskId },
      data: {
        status,
        ...(status === AreaTaskStatus.en_proceso && { startedAt: now }),
        ...(status === AreaTaskStatus.terminado && { completedAt: now }),
      },
      select: this.taskSelect(),
    });

    await this.syncOrderStatusFromTasks(task.orderId);
    if (status === AreaTaskStatus.terminado) {
      await this.notifyReceptionOfProgress(task.orderId, task.area);
    }
    return updated;
  }

  /**
   * Reasigna una tarea. Recepción/admin pueden asignar a cualquiera del área;
   * un empleado del área puede tomársela para sí mismo (WORKFLOW.md §5).
   */
  async assign(
    taskId: number,
    assignedUserId: number | null,
    requestingUser: RequestingUser,
  ) {
    const task = await this.prisma.orderAreaTask.findUnique({
      where: { id: taskId },
      select: { id: true, area: true },
    });
    if (!task) {
      throw new HttpException('La tarea no existe', HttpStatus.NOT_FOUND);
    }

    const isManager = requestingUser.roles.some((r) =>
      TASK_MANAGER_ROLES.includes(r),
    );
    const isSelfAssign = assignedUserId === requestingUser.userId;
    if (!isManager && !isSelfAssign) {
      throw new HttpException(
        'Sólo Recepción o un administrador pueden asignar la tarea a otra persona',
        HttpStatus.FORBIDDEN,
      );
    }
    this.assertCanWorkArea(task.area, requestingUser);

    if (assignedUserId !== null) {
      const user = await this.prisma.user.findUnique({
        where: { id: assignedUserId },
        select: { roles: { select: { name: true } } },
      });
      if (!user) {
        throw new HttpException(
          'El usuario asignado no existe',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!user.roles.some((r) => r.name === task.area)) {
        throw new HttpException(
          `El usuario asignado no pertenece al área ${task.area}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    return this.prisma.orderAreaTask.update({
      where: { id: taskId },
      data: { assignedUserId },
      select: this.taskSelect(),
    });
  }

  /** Quita un área del pedido (sólo Recepción/admin). */
  async remove(taskId: number, requestingUser: RequestingUser) {
    const isManager = requestingUser.roles.some((r) =>
      TASK_MANAGER_ROLES.includes(r),
    );
    if (!isManager) {
      throw new HttpException(
        'Sólo Recepción o un administrador pueden quitar un área del pedido',
        HttpStatus.FORBIDDEN,
      );
    }
    const task = await this.prisma.orderAreaTask.findUnique({
      where: { id: taskId },
      select: { orderId: true },
    });
    if (!task) {
      throw new HttpException('La tarea no existe', HttpStatus.NOT_FOUND);
    }
    await this.prisma.orderAreaTask.delete({ where: { id: taskId } });
    await this.syncOrderStatusFromTasks(task.orderId);
    return { deleted: true };
  }

  /**
   * Un usuario sólo puede mover tareas de sus propias áreas; Recepción y admin
   * pueden con todas.
   */
  private assertCanWorkArea(area: string, requestingUser: RequestingUser) {
    const isManager = requestingUser.roles.some((r) =>
      TASK_MANAGER_ROLES.includes(r),
    );
    if (isManager) return;
    if (!requestingUser.roles.includes(area)) {
      throw new HttpException(
        `Sin permiso para trabajar tareas del área ${area}`,
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * Deriva el estado global del pedido de sus tareas: si todas terminaron pasa
   * a "listo para entregar" (terminado). NUNCA lo marca como entregado: eso lo
   * confirma Recepción.
   *
   * No toca pedidos ya entregados/cancelados ni pedidos sin tareas.
   */
  private async syncOrderStatusFromTasks(orderId: number) {
    const tasks = await this.prisma.orderAreaTask.findMany({
      where: { orderId },
      select: { status: true },
    });
    if (tasks.length === 0) return;

    const allDone = tasks.every((t) => t.status === AreaTaskStatus.terminado);
    if (!allDone) return;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { statusId: true },
    });
    // 5 = entregado, 10 = cancelado: estados finales que no se pisan.
    if (!order || order.statusId === 5 || order.statusId === 10) return;
    if (order.statusId === READY_FOR_DELIVERY_STATUS_ID) return;

    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: { statusId: READY_FOR_DELIVERY_STATUS_ID },
      }),
      this.prisma.orderHistory.create({
        data: {
          orderId,
          previousStatusId: order.statusId,
          newStatusId: READY_FOR_DELIVERY_STATUS_ID,
        },
      }),
    ]);

    await this.notifyReceptionOrderReady(orderId);
  }

  /** Recepción sigue el avance global: aviso por cada etapa completada. */
  private async notifyReceptionOfProgress(orderId: number, area: string) {
    const receptionIds = await this.notificationService.userIdsForArea(
      Role.RECEPCION,
    );
    await this.notificationService.createNotificationForUsers(receptionIds, {
      type: 'area_task_completed',
      title: `${area} terminó su parte`,
      body: `Pedido #${orderId}: el área ${area} completó su tarea`,
      orderId,
    });
  }

  private async notifyReceptionOrderReady(orderId: number) {
    const receptionIds = await this.notificationService.userIdsForArea(
      Role.RECEPCION,
    );
    await this.notificationService.createNotificationForUsers(receptionIds, {
      type: 'order_ready',
      title: 'Pedido listo para entregar',
      body: `Pedido #${orderId}: todas las áreas terminaron, falta confirmar la entrega`,
      orderId,
    });
  }
}
