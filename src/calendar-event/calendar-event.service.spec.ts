import { AreaTaskStatus, CalendarEventCategory } from '@prisma/client';
import { HttpException } from '@nestjs/common';
import { CalendarEventService } from './calendar-event.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CalendarEventService', () => {
  let service: CalendarEventService;
  let prisma: {
    calendarEvent: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      calendarEvent: {
        create: jest.fn((args: { data: unknown }) => ({
          id: 1,
          status: AreaTaskStatus.pendiente,
          ...(args.data as object),
        })),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn((args: { data: unknown }) => ({
          id: 1,
          ...(args.data as object),
        })),
        delete: jest.fn(),
      },
    };
    service = new CalendarEventService(prisma as unknown as PrismaService);
  });

  it('crea un evento con el creador tomado del token, no del body', async () => {
    await service.create(
      { title: 'Instalar anuncio', eventDate: '2026-09-15T15:00:00.000Z' },
      7,
    );
    expect(prisma.calendarEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdById: 7 }),
      }),
    );
  });

  it('pasa la categoría elegida al crear', async () => {
    await service.create(
      {
        title: 'Junta de proveedores',
        eventDate: '2026-09-15T15:00:00.000Z',
        category: CalendarEventCategory.junta,
      },
      7,
    );
    expect(prisma.calendarEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: CalendarEventCategory.junta,
        }),
      }),
    );
  });

  it('permite cambiar la categoría de un evento existente', async () => {
    prisma.calendarEvent.findUnique.mockResolvedValue({
      id: 1,
      status: AreaTaskStatus.pendiente,
    });
    await service.update(1, { category: CalendarEventCategory.entrega });
    expect(prisma.calendarEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: CalendarEventCategory.entrega,
        }),
      }),
    );
  });

  it('lanza 404 al actualizar el estado de un evento inexistente', async () => {
    prisma.calendarEvent.findUnique.mockResolvedValue(null);
    await expect(
      service.updateStatus(999, AreaTaskStatus.en_proceso),
    ).rejects.toThrow(HttpException);
  });

  it('no deja saltar de pendiente a terminado sin pasar por en_proceso', async () => {
    prisma.calendarEvent.findUnique.mockResolvedValue({
      id: 1,
      status: AreaTaskStatus.pendiente,
    });
    await expect(
      service.updateStatus(1, AreaTaskStatus.terminado),
    ).rejects.toThrow(HttpException);
    expect(prisma.calendarEvent.update).not.toHaveBeenCalled();
  });

  it('permite retroceder un paso, de en_proceso a pendiente (corregir un clic)', async () => {
    prisma.calendarEvent.findUnique.mockResolvedValue({
      id: 1,
      status: AreaTaskStatus.en_proceso,
    });
    await service.updateStatus(1, AreaTaskStatus.pendiente);
    expect(prisma.calendarEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { status: AreaTaskStatus.pendiente },
      }),
    );
  });

  it('avanza de pendiente a en_proceso', async () => {
    prisma.calendarEvent.findUnique.mockResolvedValue({
      id: 1,
      status: AreaTaskStatus.pendiente,
    });
    await service.updateStatus(1, AreaTaskStatus.en_proceso);
    expect(prisma.calendarEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: AreaTaskStatus.en_proceso } }),
    );
  });

  it('al cambiar la anticipación del recordatorio, limpia reminderSentAt para poder mandarlo de nuevo', async () => {
    prisma.calendarEvent.findUnique.mockResolvedValue({
      id: 1,
      status: AreaTaskStatus.pendiente,
    });
    await service.update(1, { reminderMinutesBefore: 30 });
    expect(prisma.calendarEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reminderMinutesBefore: 30,
          reminderSentAt: null,
        }),
      }),
    );
  });

  it('lanza 404 al borrar un evento inexistente', async () => {
    prisma.calendarEvent.findUnique.mockResolvedValue(null);
    await expect(service.remove(999)).rejects.toThrow(HttpException);
  });
});
