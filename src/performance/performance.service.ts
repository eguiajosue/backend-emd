import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { mean, standardDeviation } from 'simple-statistics';

const ss = { mean, standardDeviation };

/** Nombre del estado que representa un pedido ya entregado. */
const DELIVERED_STATUS_NAME = 'entregado';

/** Mínimo de pedidos completados para entrar al ranking (si no, score: null). */
const MIN_COMPLETED_FOR_SCORE = 2;

export interface PerformanceMetrics {
  totalAssigned: number;
  totalCompleted: number;
  avgTurnaroundHours: number | null;
  onTimeRate: number | null;
}

export interface EmployeePerformance extends PerformanceMetrics {
  userId: number;
  firstName: string;
  lastName: string | null;
  username: string;
  score: number | null;
}

export interface AreaPerformance extends PerformanceMetrics {
  area: string;
  score: number | null;
}

interface OrderForMetrics {
  id: number;
  statusName: string;
  creationDate: Date;
  deliveryDate: Date | null;
}

@Injectable()
export class PerformanceService {
  constructor(private prisma: PrismaService) {}

  /** Calcula las métricas base (sin score) para un grupo de pedidos. */
  private computeMetrics(
    orders: OrderForMetrics[],
    deliveredChangeDateByOrderId: Map<number, Date>,
  ): PerformanceMetrics {
    const totalAssigned = orders.length;
    const completedOrders = orders.filter(
      (o) => o.statusName === DELIVERED_STATUS_NAME,
    );
    const totalCompleted = completedOrders.length;

    const turnaroundHours: number[] = [];
    let onTimeCount = 0;
    let withDeliveryDateCount = 0;

    for (const order of completedOrders) {
      const changeDate = deliveredChangeDateByOrderId.get(order.id);
      if (!changeDate) {
        // Sin registro de historial de la transición a "entregado": se
        // ignora del promedio, no rompe el cálculo.
        continue;
      }
      const hours =
        (changeDate.getTime() - order.creationDate.getTime()) /
        (1000 * 60 * 60);
      turnaroundHours.push(hours);

      if (order.deliveryDate) {
        withDeliveryDateCount++;
        if (changeDate.getTime() <= order.deliveryDate.getTime()) {
          onTimeCount++;
        }
      }
    }

    return {
      totalAssigned,
      totalCompleted,
      avgTurnaroundHours:
        turnaroundHours.length > 0 ? ss.mean(turnaroundHours) : null,
      onTimeRate:
        withDeliveryDateCount > 0 ? onTimeCount / withDeliveryDateCount : null,
    };
  }

  /**
   * Combina z-score de avgTurnaroundHours (invertido: menor es mejor) y de
   * onTimeRate (mayor es mejor) en un score compuesto simple: el promedio de
   * ambos z-scores. Solo se calcula para entidades con al menos
   * MIN_COMPLETED_FOR_SCORE pedidos completados Y datos suficientes para
   * comparar contra el resto (desviación estándar > 0); de lo contrario el
   * score queda en null ("datos insuficientes").
   */
  private assignScores<
    T extends {
      totalCompleted: number;
      avgTurnaroundHours: number | null;
      onTimeRate: number | null;
    },
  >(entries: T[]): (T & { score: number | null })[] {
    const eligible = entries.filter(
      (e) =>
        e.totalCompleted >= MIN_COMPLETED_FOR_SCORE &&
        e.avgTurnaroundHours != null &&
        e.onTimeRate != null,
    );

    const turnaroundValues = eligible.map(
      (e) => e.avgTurnaroundHours as number,
    );
    const onTimeValues = eligible.map((e) => e.onTimeRate as number);

    const turnaroundMean = turnaroundValues.length
      ? ss.mean(turnaroundValues)
      : 0;
    const turnaroundStd = turnaroundValues.length
      ? ss.standardDeviation(turnaroundValues)
      : 0;
    const onTimeMean = onTimeValues.length ? ss.mean(onTimeValues) : 0;
    const onTimeStd = onTimeValues.length
      ? ss.standardDeviation(onTimeValues)
      : 0;

    return entries.map((e) => {
      if (
        e.totalCompleted < MIN_COMPLETED_FOR_SCORE ||
        e.avgTurnaroundHours == null ||
        e.onTimeRate == null ||
        eligible.length < 2 ||
        turnaroundStd === 0 ||
        onTimeStd === 0
      ) {
        return { ...e, score: null };
      }
      const zTurnaround = -(
        (e.avgTurnaroundHours - turnaroundMean) /
        turnaroundStd
      );
      const zOnTime = (e.onTimeRate - onTimeMean) / onTimeStd;
      const score = (zTurnaround + zOnTime) / 2;
      return { ...e, score };
    });
  }

  private sortByScoreDesc<T extends { score: number | null }>(
    entries: T[],
  ): T[] {
    return [...entries].sort((a, b) => {
      if (a.score == null && b.score == null) return 0;
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return b.score - a.score;
    });
  }

  async getSummary(): Promise<{
    employees: EmployeePerformance[];
    areas: AreaPerformance[];
  }> {
    const deliveredStatus = await this.prisma.status.findUnique({
      where: { name: DELIVERED_STATUS_NAME },
    });

    // Historial de transiciones a "entregado", por orden (usamos la fecha
    // más temprana en que ocurrió, por si hubiera más de una).
    const deliveredChangeDateByOrderId = new Map<number, Date>();
    if (deliveredStatus) {
      const histories = await this.prisma.orderHistory.findMany({
        where: { newStatusId: deliveredStatus.id },
        select: { orderId: true, changeDate: true },
        orderBy: { changeDate: 'asc' },
      });
      for (const h of histories) {
        if (!deliveredChangeDateByOrderId.has(h.orderId)) {
          deliveredChangeDateByOrderId.set(h.orderId, h.changeDate);
        }
      }
    }

    // --- Empleados: todo pedido con assignedUserId, agrupado por usuario. ---
    const usersWithAssignedOrders = await this.prisma.user.findMany({
      where: { assignedOrders: { some: {} } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        assignedOrders: {
          select: {
            id: true,
            creationDate: true,
            deliveryDate: true,
            status: { select: { name: true } },
          },
        },
      },
    });

    const employeesRaw = usersWithAssignedOrders.map((user) => {
      const orders: OrderForMetrics[] = user.assignedOrders.map((o) => ({
        id: o.id,
        statusName: o.status.name,
        creationDate: o.creationDate,
        deliveryDate: o.deliveryDate,
      }));
      const metrics = this.computeMetrics(orders, deliveredChangeDateByOrderId);
      return {
        userId: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        ...metrics,
      };
    });

    // --- Áreas: todos los pedidos de esa área, sin importar a quién asignados. ---
    const ordersWithArea = await this.prisma.order.findMany({
      where: { area: { not: null } },
      select: {
        id: true,
        area: true,
        creationDate: true,
        deliveryDate: true,
        status: { select: { name: true } },
      },
    });

    const ordersByArea = new Map<string, OrderForMetrics[]>();
    for (const order of ordersWithArea) {
      const area = order.area as string;
      const list = ordersByArea.get(area) ?? [];
      list.push({
        id: order.id,
        statusName: order.status.name,
        creationDate: order.creationDate,
        deliveryDate: order.deliveryDate,
      });
      ordersByArea.set(area, list);
    }

    const areasRaw = Array.from(ordersByArea.entries()).map(
      ([area, orders]) => ({
        area,
        ...this.computeMetrics(orders, deliveredChangeDateByOrderId),
      }),
    );

    const employees = this.sortByScoreDesc(this.assignScores(employeesRaw));
    const areas = this.sortByScoreDesc(this.assignScores(areasRaw));

    return { employees, areas };
  }
}
