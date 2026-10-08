import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { PRODUCTION_AREAS } from 'src/order/dto/create-order.dto';
import {
  StatusIdResolver,
  STATUS_NAME_AUTORIZADO,
  STATUS_NAME_CANCELADO,
  STATUS_NAME_ENTREGADO,
  STATUS_NAME_ESPERANDO_AUTORIZACION,
  STATUS_NAME_TERMINADO,
} from 'src/order/status-id-resolver';
import {
  daysLate,
  deadlineState,
  loadByArea,
  summarize,
  type DelayReason,
} from './coordination.rules';

/** Ventana de los tiempos por etapa. */
const STAGE_WINDOW_DAYS = 30;

/**
 * Tablero de Coordinación (WORKFLOW.md §9): para Recepción y gestión, en una
 * sola respuesta, cuánto trabajo tiene cada área y cada persona, cuánto tarda
 * cada etapa y qué pedidos van atrasados (con su motivo).
 */
@Injectable()
export class CoordinationService {
  private readonly statusIds: StatusIdResolver;

  constructor(private readonly prisma: PrismaService) {
    this.statusIds = new StatusIdResolver(prisma);
  }

  async overview(now = new Date()) {
    const [entregado, cancelado] = await Promise.all([
      this.statusIds.idFor(STATUS_NAME_ENTREGADO),
      this.statusIds.idFor(STATUS_NAME_CANCELADO),
    ]);
    const closed = [entregado, cancelado];
    const [load, stageTimes, overdue] = await Promise.all([
      this.load(closed, now),
      this.stageTimes(now),
      this.overdue(closed, now),
    ]);
    return { generatedAt: now.toISOString(), load, stageTimes, overdue };
  }

  private async load(closed: number[], now: Date) {
    const tasks = await this.prisma.orderAreaTask.findMany({
      where: {
        status: { not: 'terminado' },
        order: { statusId: { notIn: closed }, NOT: { area: 'diseno' } },
      },
      select: {
        area: true,
        status: true,
        assignedUserId: true,
        assignedUser: {
          select: { firstName: true, lastName: true, isSharedAccount: true },
        },
        order: { select: { deliveryDate: true } },
      },
    });
    return loadByArea(
      tasks.map((t) => ({
        area: t.area,
        status: t.status,
        assignedUserId: t.assignedUserId,
        assigneeName: t.assignedUser
          ? [t.assignedUser.firstName, t.assignedUser.lastName]
              .filter(Boolean)
              .join(' ')
          : null,
        sharedAccount: !!t.assignedUser?.isSharedAccount,
        deliveryDate: t.order.deliveryDate,
      })),
      now,
      PRODUCTION_AREAS,
    );
  }

  /**
   * Mediana y p75 de cada etapa en los últimos 30 días:
   * diseño (alta → se manda a autorizar), autorización del cliente, espera
   * en cada área (autorizado/asignado → la empiezan), producción por área
   * (empieza → termina) y entrega (listo → entregado).
   */
  private async stageTimes(now: Date) {
    const since = new Date(now.getTime() - STAGE_WINDOW_DAYS * 86_400_000);
    const [esperando, autorizado, terminado, entregado] = await Promise.all(
      [
        STATUS_NAME_ESPERANDO_AUTORIZACION,
        STATUS_NAME_AUTORIZADO,
        STATUS_NAME_TERMINADO,
        STATUS_NAME_ENTREGADO,
      ].map((n) => this.statusIds.idFor(n)),
    );
    const histories = await this.prisma.orderHistory.findMany({
      where: {
        changeDate: { gte: since },
        newStatusId: { in: [esperando, autorizado, entregado] },
      },
      select: {
        orderId: true,
        newStatusId: true,
        changeDate: true,
        order: { select: { creationDate: true } },
      },
      orderBy: { changeDate: 'asc' },
    });
    const orderIds = [...new Set(histories.map((h) => h.orderId))];
    const earlier = orderIds.length
      ? await this.prisma.orderHistory.findMany({
          where: {
            orderId: { in: orderIds },
            newStatusId: { in: [esperando, terminado] },
          },
          select: { orderId: true, newStatusId: true, changeDate: true },
          orderBy: { changeDate: 'asc' },
        })
      : [];
    // Último "esperando autorización" y último "terminado" previos a cada cambio.
    const lastBefore = (orderId: number, statusId: number, at: Date) => {
      let found: Date | null = null;
      for (const h of earlier) {
        if (h.orderId !== orderId || h.newStatusId !== statusId) continue;
        if (h.changeDate <= at) found = h.changeDate;
      }
      return found;
    };

    const design: number[] = [];
    const approval: number[] = [];
    const handover: number[] = [];
    // Diseño = alta → PRIMER envío a autorizar (las rondas de cambios no).
    const firstSentAt = new Map<number, number>();
    for (const h of earlier) {
      if (h.newStatusId === esperando && !firstSentAt.has(h.orderId)) {
        firstSentAt.set(h.orderId, h.changeDate.getTime());
      }
    }
    for (const h of histories) {
      const at = h.changeDate.getTime();
      if (h.newStatusId === esperando) {
        if (firstSentAt.get(h.orderId) === at) {
          design.push(at - h.order.creationDate.getTime());
        }
      } else if (h.newStatusId === autorizado) {
        const sent = lastBefore(h.orderId, esperando, h.changeDate);
        if (sent) approval.push(at - sent.getTime());
      } else if (h.newStatusId === entregado) {
        const ready = lastBefore(h.orderId, terminado, h.changeDate);
        if (ready) handover.push(at - ready.getTime());
      }
    }

    const tasks = await this.prisma.orderAreaTask.findMany({
      where: { startedAt: { gte: since } },
      select: {
        area: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
      },
    });
    const queue = new Map<string, number[]>();
    const work = new Map<string, number[]>();
    const push = (m: Map<string, number[]>, k: string, v: number) =>
      m.set(k, [...(m.get(k) ?? []), v]);
    for (const t of tasks) {
      push(queue, t.area, t.startedAt!.getTime() - t.createdAt.getTime());
      if (t.completedAt) {
        push(work, t.area, t.completedAt.getTime() - t.startedAt!.getTime());
      }
    }

    return {
      windowDays: STAGE_WINDOW_DAYS,
      stages: [
        { key: 'diseno', label: 'Diseño', ...summarize(design) },
        {
          key: 'autorizacion',
          label: 'Autorización del cliente',
          ...summarize(approval),
        },
        { key: 'entrega', label: 'Listo → entregado', ...summarize(handover) },
      ],
      areas: PRODUCTION_AREAS.map((area) => ({
        area,
        espera: summarize(queue.get(area) ?? []),
        produccion: summarize(work.get(area) ?? []),
      })),
    };
  }

  private async overdue(closed: number[], now: Date) {
    const orders = await this.prisma.order.findMany({
      where: {
        statusId: { notIn: closed },
        deliveryDate: { not: null, lt: now },
      },
      select: {
        id: true,
        description: true,
        deliveryDate: true,
        clientNameOverride: true,
        client: { select: { first_name: true, last_name: true } },
        status: { select: { name: true } },
        delayReason: true,
        delayNote: true,
        delayReasonAt: true,
        areaTasks: {
          select: {
            area: true,
            status: true,
            prepStage: true,
            assignedUser: {
              select: { firstName: true, isSharedAccount: true },
            },
          },
        },
      },
      orderBy: { deliveryDate: 'asc' },
      take: 200,
    });
    return orders
      .filter((o) => deadlineState(o.deliveryDate, now) === 'atrasado')
      .map((o) => ({
        id: o.id,
        description: o.description,
        clientName: o.client
          ? [o.client.first_name, o.client.last_name].filter(Boolean).join(' ')
          : (o.clientNameOverride ?? null),
        deliveryDate: o.deliveryDate!.toISOString(),
        daysLate: daysLate(o.deliveryDate, now),
        status: o.status.name,
        reason: o.delayReason as DelayReason | null,
        note: o.delayNote,
        reasonAt: o.delayReasonAt?.toISOString() ?? null,
        areas: o.areaTasks.map((t) => ({
          area: t.area,
          status: t.status,
          prepStage: t.prepStage,
          assignee:
            t.assignedUser && !t.assignedUser.isSharedAccount
              ? t.assignedUser.firstName
              : null,
        })),
      }));
  }

  /** Registra (o borra, con `reason: null`) el motivo del atraso. */
  async setDelayReason(
    orderId: number,
    reason: DelayReason | null,
    note: string | undefined,
    userId: number,
  ) {
    const exists = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true },
    });
    if (!exists) {
      throw new HttpException('Pedido no encontrado', HttpStatus.NOT_FOUND);
    }
    return this.prisma.order.update({
      where: { id: orderId },
      data: reason
        ? {
            delayReason: reason,
            delayNote: note?.trim() || null,
            delayReasonAt: new Date(),
            delayReasonById: userId,
          }
        : {
            delayReason: null,
            delayNote: null,
            delayReasonAt: null,
            delayReasonById: null,
          },
      select: {
        id: true,
        delayReason: true,
        delayNote: true,
        delayReasonAt: true,
      },
    });
  }
}
