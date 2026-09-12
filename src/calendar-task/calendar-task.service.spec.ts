import { HttpException } from '@nestjs/common';
import { CalendarTaskService } from './calendar-task.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CalendarTaskService', () => {
  let service: CalendarTaskService;
  let prisma: {
    calendarTask: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      calendarTask: {
        create: jest.fn((args: { data: unknown }) => ({
          id: 1,
          completed: false,
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
    service = new CalendarTaskService(prisma as unknown as PrismaService);
  });

  it('crea una tarea con el creador tomado del token, no del body', async () => {
    await service.create({ title: 'Confirmar medidas con cliente' }, 7);
    expect(prisma.calendarTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdById: 7 }),
      }),
    );
  });

  it('pasa el pedido vinculado al crear', async () => {
    await service.create(
      { title: 'Confirmar medidas con cliente', orderId: 42 },
      7,
    );
    expect(prisma.calendarTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderId: 42 }),
      }),
    );
  });

  it('permite crear sin descripción', async () => {
    await service.create({ title: 'Preparar material' }, 7);
    expect(prisma.calendarTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ description: undefined }),
      }),
    );
  });

  it('lanza 404 al actualizar una tarea inexistente', async () => {
    prisma.calendarTask.findUnique.mockResolvedValue(null);
    await expect(
      service.update(999, { title: 'Nuevo título' }),
    ).rejects.toThrow(HttpException);
  });

  it('al marcar una tarea como completada, guarda completedAt', async () => {
    prisma.calendarTask.findUnique.mockResolvedValue({
      id: 1,
      completed: false,
    });
    await service.setCompleted(1, true);
    expect(prisma.calendarTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { completed: true, completedAt: expect.any(Date) },
      }),
    );
  });

  it('al desmarcar una tarea completada, limpia completedAt', async () => {
    prisma.calendarTask.findUnique.mockResolvedValue({
      id: 1,
      completed: true,
    });
    await service.setCompleted(1, false);
    expect(prisma.calendarTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { completed: false, completedAt: null },
      }),
    );
  });

  it('lanza 404 al marcar como completada una tarea inexistente', async () => {
    prisma.calendarTask.findUnique.mockResolvedValue(null);
    await expect(service.setCompleted(999, true)).rejects.toThrow(
      HttpException,
    );
  });

  it('lanza 404 al borrar una tarea inexistente', async () => {
    prisma.calendarTask.findUnique.mockResolvedValue(null);
    await expect(service.remove(999)).rejects.toThrow(HttpException);
  });

  it('borra una tarea existente', async () => {
    prisma.calendarTask.findUnique.mockResolvedValue({ id: 1 });
    const result = await service.remove(1);
    expect(prisma.calendarTask.delete).toHaveBeenCalledWith({
      where: { id: 1 },
    });
    expect(result).toEqual({ success: true });
  });
});
