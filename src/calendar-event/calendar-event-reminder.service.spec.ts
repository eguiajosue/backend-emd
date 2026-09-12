import {
  CalendarEventReminderService,
  CALENDAR_EVENT_REMINDER_TYPE,
} from './calendar-event-reminder.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from 'src/notification/notification.service';

describe('CalendarEventReminderService', () => {
  let service: CalendarEventReminderService;
  let prisma: {
    calendarEvent: { findMany: jest.Mock; update: jest.Mock };
    user: { findMany: jest.Mock };
  };
  let notificationService: { createNotificationForUsers: jest.Mock };

  const now = new Date('2026-09-15T14:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    prisma = {
      calendarEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      },
    };
    notificationService = { createNotificationForUsers: jest.fn() };
    service = new CalendarEventReminderService(
      prisma as unknown as PrismaService,
      notificationService as unknown as NotificationService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('manda el recordatorio custom cuando ya venció su anticipación y marca reminderSentAt', async () => {
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([
        {
          id: 1,
          title: 'Instalar torniquetes',
          clientName: 'MEDLINE',
          eventDate: new Date('2026-09-15T14:20:00.000Z'), // en 20 min
          reminderMinutesBefore: 30, // pedido: avisar 30 min antes -> ya venció
        },
      ])
      .mockResolvedValueOnce([]); // sin candidatos para el aviso final en esta llamada

    await service.sendDueReminders();

    expect(notificationService.createNotificationForUsers).toHaveBeenCalledWith(
      [1, 2],
      expect.objectContaining({
        type: CALENDAR_EVENT_REMINDER_TYPE,
        body: 'MEDLINE · Instalar torniquetes',
      }),
    );
    expect(prisma.calendarEvent.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { reminderSentAt: now },
    });
  });

  it('no manda el recordatorio custom si todavía no venció su anticipación', async () => {
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([
        {
          id: 1,
          title: 'Visita a planta',
          clientName: 'MEDLINE',
          eventDate: new Date('2026-09-16T14:00:00.000Z'), // en 24h
          reminderMinutesBefore: 30, // todavía falta mucho
        },
      ])
      .mockResolvedValueOnce([]);

    await service.sendDueReminders();

    expect(
      notificationService.createNotificationForUsers,
    ).not.toHaveBeenCalled();
  });

  it('manda el aviso fijo de 1h antes aunque el evento no tenga anticipación custom', async () => {
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([]) // sin candidatos custom
      .mockResolvedValueOnce([
        {
          id: 2,
          title: 'Entregar sello',
          clientName: 'NLDC',
          eventDate: new Date('2026-09-15T14:45:00.000Z'), // en 45 min: ya dentro de la ventana de 1h
        },
      ]);

    await service.sendDueReminders();

    expect(notificationService.createNotificationForUsers).toHaveBeenCalledWith(
      [1, 2],
      expect.objectContaining({ body: 'NLDC · Entregar sello' }),
    );
    expect(prisma.calendarEvent.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { finalReminderSentAt: now },
    });
  });
});
