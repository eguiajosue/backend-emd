import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from 'src/notification/notification.service';
import { Role } from 'src/common/enums/roles.enum';

/** Aviso fijo que siempre se manda, además de la anticipación que haya pedido el usuario. */
export const FINAL_REMINDER_MINUTES_BEFORE = 60;

/** Tipo de notificación persistida para estos avisos (ver NotificationService). */
export const CALENDAR_EVENT_REMINDER_TYPE = 'calendar_event_reminder';

/**
 * Recordatorios push del calendario de equipo de Recepción: cada minuto
 * revisa qué eventos "vencieron" su aviso (con la anticipación que pidió
 * quien lo creó, y siempre también 1h antes como piso mínimo) y notifica a
 * TODO el equipo (recepcion/admin/superuser) — el calendario es compartido,
 * así que el aviso también lo es, no sólo para quien lo creó.
 *
 * Cada evento manda como máximo un aviso "custom" y un aviso "final" (marca
 * `reminderSentAt`/`finalReminderSentAt` para no repetir).
 */
@Injectable()
export class CalendarEventReminderService {
  private readonly logger = new Logger('CalendarEventReminderService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sendDueReminders() {
    const now = new Date();
    await this.sendCustomReminders(now);
    await this.sendFinalReminders(now);
  }

  private async sendCustomReminders(now: Date) {
    const candidates = await this.prisma.calendarEvent.findMany({
      where: {
        reminderMinutesBefore: { not: null },
        reminderSentAt: null,
        eventDate: { gt: now },
      },
      select: {
        id: true,
        title: true,
        clientName: true,
        eventDate: true,
        reminderMinutesBefore: true,
      },
    });

    const due = candidates.filter((event) => {
      const dueAt = new Date(
        event.eventDate.getTime() - event.reminderMinutesBefore! * 60_000,
      );
      return dueAt <= now;
    });

    for (const event of due) {
      await this.sendReminder(event, 'reminderSentAt');
    }
  }

  private async sendFinalReminders(now: Date) {
    const candidates = await this.prisma.calendarEvent.findMany({
      where: {
        finalReminderSentAt: null,
        eventDate: { gt: now },
      },
      select: { id: true, title: true, clientName: true, eventDate: true },
    });

    const due = candidates.filter((event) => {
      const dueAt = new Date(
        event.eventDate.getTime() - FINAL_REMINDER_MINUTES_BEFORE * 60_000,
      );
      return dueAt <= now;
    });

    for (const event of due) {
      await this.sendReminder(event, 'finalReminderSentAt');
    }
  }

  private async sendReminder(
    event: { id: number; title: string; clientName: string | null },
    sentField: 'reminderSentAt' | 'finalReminderSentAt',
  ) {
    try {
      const recipientIds = await this.teamUserIds();
      const body = event.clientName
        ? `${event.clientName} · ${event.title}`
        : event.title;
      await this.notificationService.createNotificationForUsers(recipientIds, {
        type: CALENDAR_EVENT_REMINDER_TYPE,
        title: 'Recordatorio de calendario',
        body,
      });
      await this.prisma.calendarEvent.update({
        where: { id: event.id },
        data: { [sentField]: new Date() },
      });
    } catch (error) {
      this.logger.warn(
        `Fallo mandando recordatorio del evento ${event.id}: ${
          (error as Error).message
        }`,
      );
    }
  }

  /** Todo el equipo con acceso al calendario: recepcion + admin + superuser. */
  private async teamUserIds(): Promise<number[]> {
    const users = await this.prisma.user.findMany({
      where: {
        roles: {
          some: {
            name: { in: [Role.RECEPCION, Role.ADMIN, Role.SUPERUSER] },
          },
        },
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }
}
