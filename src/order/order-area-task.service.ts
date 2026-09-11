import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { AreaTaskStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from 'src/notification/notification.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { Role } from 'src/common/enums/roles.enum';
import { PRODUCTION_AREAS } from './dto/create-order.dto';
import type { RequestingUser } from './order.service';
import {
  StatusIdResolver,
  STATUS_NAME_AUTORIZADO,
  STATUS_NAME_CANCELADO,
  STATUS_NAME_ENTREGADO,
  STATUS_NAME_TERMINADO,
} from './status-id-resolver';

/*
 * Todos los estados globales que toca este servicio se resuelven por NOMBRE
 * (ver StatusIdResolver): sus ids dependen del orden del seed.
 *  - "terminado": listo para entregar, al que pasa el pedido cuando TODAS sus
 *    áreas terminaron. La entrega la confirma Recepción a mano, nunca
 *    automáticamente (WORKFLOW.md §3).
 *  - "autorizado": al que vuelve el pedido si un área RETROCEDE desde
 *    `terminado` estando ya listo para entregar.
 *  - "entregado"/"cancelado": estados finales, que no se pisan.
 */

/**
 * Transiciones válidas del ciclo corto de una tarea de área. Una tarea no
 * puede saltar de pendiente a terminado sin pasar por en_proceso, y se puede
 * retroceder (corregir un clic) pero sólo un paso.
 */
const ALLOWED_TASK_TRANSITIONS: Record<AreaTaskStatus, AreaTaskStatus[]> = {
  [AreaTaskStatus.pendiente]: [AreaTaskStatus.en_proceso],
  [AreaTaskStatus.en_proceso]: [
    AreaTaskStatus.terminado,
    AreaTaskStatus.pendiente,
  ],
  [AreaTaskStatus.terminado]: [AreaTaskStatus.en_proceso],
};

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
  /** Resolución cacheada de ids de Status por nombre. */
  private readonly statusIds: StatusIdResolver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {
    this.statusIds = new StatusIdResolver(this.prisma);
  }

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

  /**
   * Tareas de producción visibles para un usuario: SOLO las de sus propias
   * áreas (WORKFLOW.md §4). Si es bordador y laserista ve Bordado y Láser
   * mezcladas, cada una etiquetada con su área; nunca las de otras.
   *
   * Recepción/admin ven todas, porque siguen el avance global.
   *
   * El frontend decide con esta misma lista si mostrarlas todas juntas o
   * agrupadas por área, según la preferencia personal del usuario.
   */
  async findForUser(requestingUser: RequestingUser) {
    const closedStatusIds = await this.finalStatusIds();
    const isManager = requestingUser.roles.some((r) =>
      TASK_MANAGER_ROLES.includes(r),
    );
    const ownAreas = requestingUser.roles.filter((role) =>
      (PRODUCTION_AREAS as readonly string[]).includes(role),
    );

    // Un usuario sin áreas de producción ni rol de gestión no tiene tareas
    // propias que ver (ej. sólo Diseño): lista vacía en vez de todas.
    if (!isManager && ownAreas.length === 0) return [];

    return this.prisma.orderAreaTask.findMany({
      where: {
        ...(isManager ? {} : { area: { in: ownAreas } }),
        // Los pedidos cerrados no ensucian la bandeja de trabajo.
        order: { statusId: { notIn: closedStatusIds } },
      },
      select: {
        ...this.taskSelect(),
        order: {
          select: {
            id: true,
            description: true,
            deliveryDate: true,
            statusId: true,
            clientNameOverride: true,
            client: { select: { first_name: true, last_name: true } },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
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
      select: {
        id: true,
        orderId: true,
        area: true,
        status: true,
        assignedUserId: true,
      },
    });
    if (!task) {
      throw new HttpException('La tarea no existe', HttpStatus.NOT_FOUND);
    }
    this.assertCanWorkArea(task.area, requestingUser);
    this.assertValidTransition(task.status, status);

    // "Empezar" es "tomar" (WORKFLOW.md §3, paso 7): si la tarea está sin
    // asignar o todavía en la cuenta compartida del área, al pasarla a
    // en_proceso queda a nombre de quien la arrancó.
    // ...pero SOLO si quien la mueve pertenece al área: Recepción/admin
    // pueden mover el estado de cualquier tarea, y si se la quedaran el área
    // perdería su bandeja (mismo criterio que `assign`).
    const shouldClaim =
      status === AreaTaskStatus.en_proceso &&
      requestingUser.roles.includes(task.area) &&
      (await this.isUnclaimed(task.area, task.assignedUserId));

    const now = new Date();
    const updated = await this.prisma.orderAreaTask.update({
      where: { id: taskId },
      data: {
        status,
        ...(shouldClaim && { assignedUserId: requestingUser.userId }),
        ...(status === AreaTaskStatus.en_proceso && { startedAt: now }),
        ...(status === AreaTaskStatus.terminado && { completedAt: now }),
      },
      select: this.taskSelect(),
    });

    await this.syncOrderStatusFromTasks(task.orderId, requestingUser.userId);
    if (status === AreaTaskStatus.terminado) {
      await this.notifyReceptionOfProgress(
        task.orderId,
        task.area,
        requestingUser.userId,
      );
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
    await this.syncOrderStatusFromTasks(task.orderId, requestingUser.userId);
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

  /** Rechaza saltos de estado que no existen en el ciclo de la tarea. */
  private assertValidTransition(from: AreaTaskStatus, to: AreaTaskStatus) {
    if (from === to) return;
    if (!ALLOWED_TASK_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(
        `No se puede pasar la tarea de "${from}" a "${to}"`,
      );
    }
  }

  /**
   * Si la tarea todavía no la tomó nadie: sin responsable, o a nombre de la
   * cuenta compartida del área (que representa "cualquiera del área").
   */
  private async isUnclaimed(
    area: string,
    assignedUserId: number | null,
  ): Promise<boolean> {
    if (assignedUserId === null) return true;
    const sharedId = await this.sharedAccountIdForArea(area);
    return sharedId !== null && sharedId === assignedUserId;
  }

  /**
   * Deriva el estado global del pedido de sus tareas: si todas terminaron pasa
   * a "listo para entregar" (terminado). NUNCA lo marca como entregado: eso lo
   * confirma Recepción.
   *
   * Al revés también: si un área retrocede de `terminado` y el pedido ya
   * estaba "listo para entregar", el pedido vuelve a "autorizado". Lo mismo si
   * se quitó la última área del pedido: sin tareas no hay nada terminado.
   *
   * No toca pedidos ya entregados/cancelados.
   */
  private async syncOrderStatusFromTasks(orderId: number, actorId?: number) {
    const tasks = await this.prisma.orderAreaTask.findMany({
      where: { orderId },
      select: { status: true },
    });

    const readyId = await this.statusIds.idFor(STATUS_NAME_TERMINADO);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { statusId: true },
    });
    if (!order) return;
    // Estados finales, que no se pisan.
    const finalIds = await this.finalStatusIds();
    if (finalIds.includes(order.statusId)) return;

    // Sin tareas no queda nada "terminado": si el pedido había quedado listo
    // para entregar (se borró la última área), vuelve a "autorizado".
    const allDone =
      tasks.length > 0 &&
      tasks.every((t) => t.status === AreaTaskStatus.terminado);

    if (!allDone) {
      // Un área retrocedió (o ya no hay áreas): el pedido deja de estar listo.
      if (order.statusId !== readyId) return;
      const autorizadoId = await this.statusIds.idFor(STATUS_NAME_AUTORIZADO);
      await this.applyOrderStatus(orderId, order.statusId, autorizadoId);
      return;
    }

    if (order.statusId === readyId) return;

    // Sólo se notifica si ESTA llamada fue la que hizo la transición: dos
    // áreas terminando a la vez no pueden generar dos avisos.
    const applied = await this.applyOrderStatus(
      orderId,
      order.statusId,
      readyId,
    );
    if (!applied) return;

    await this.notifyReceptionOrderReady(orderId, actorId);
  }

  /**
   * Cambia el estado global del pedido dejando rastro en el historial.
   *
   * El update es CONDICIONAL y va dentro de la transacción
   * (`updateMany` con el estado previo en el `where`): si otra área ya movió
   * el pedido entre el read y el write, `count` es 0, no se escribe historial
   * y el llamador sabe que la transición no fue suya. Evita dos
   * `OrderHistory` y dos notificaciones de la misma transición.
   */
  private async applyOrderStatus(
    orderId: number,
    previousStatusId: number,
    newStatusId: number,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: orderId, statusId: previousStatusId },
        data: { statusId: newStatusId },
      });
      if (count !== 1) return false;
      await tx.orderHistory.create({
        data: { orderId, previousStatusId, newStatusId },
      });
      return true;
    });
  }

  /** Ids de los estados finales, que este servicio nunca pisa. */
  private async finalStatusIds(): Promise<number[]> {
    return Promise.all([
      this.statusIds.idFor(STATUS_NAME_ENTREGADO),
      this.statusIds.idFor(STATUS_NAME_CANCELADO),
    ]);
  }

  /**
   * Destinatario EFECTIVO de los avisos que van "a Recepción" en este pedido:
   * quien lo ATIENDE hoy (`attendedByUserId`) o, si nadie lo tomó, quien lo
   * creó (`userId`). Ver `OrderService.receptionOwnerIdOf` y WORKFLOW.md §2.
   */
  private async orderReceptionOwnerId(orderId: number): Promise<number | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true, attendedByUserId: true },
    });
    if (!order) return null;
    return order.attendedByUserId ?? order.userId;
  }

  /** Recepción sigue el avance global: aviso por cada etapa completada. */
  private async notifyReceptionOfProgress(
    orderId: number,
    area: string,
    actorId?: number,
  ) {
    // Va SÓLO a UNA recepcionista, no a todo el área: la que le está
    // siguiendo el rastro a ese cliente, o sea quien atiende el pedido
    // (WORKFLOW.md §2).
    const receptionOwnerId = await this.orderReceptionOwnerId(orderId);
    // Nadie recibe el aviso de su propia acción.
    if (receptionOwnerId === null || receptionOwnerId === actorId) return;
    await this.notificationService.createNotification({
      userId: receptionOwnerId,
      type: 'area_task_completed',
      title: `${area} terminó su parte`,
      body: `Pedido #${orderId}: el área ${area} completó su tarea`,
      orderId,
    });
  }

  private async notifyReceptionOrderReady(orderId: number, actorId?: number) {
    const receptionOwnerId = await this.orderReceptionOwnerId(orderId);
    // Nadie recibe el aviso de su propia acción.
    if (receptionOwnerId === null || receptionOwnerId === actorId) return;
    await this.notificationService.createNotification({
      userId: receptionOwnerId,
      type: 'order_ready',
      title: 'Pedido listo para entregar',
      body: `Pedido #${orderId}: todas las áreas terminaron, falta confirmar la entrega`,
      orderId,
    });
  }
}
