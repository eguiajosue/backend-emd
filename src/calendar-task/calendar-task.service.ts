import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCalendarTaskDto } from './dto/create-calendar-task.dto';
import { UpdateCalendarTaskDto } from './dto/update-calendar-task.dto';

/**
 * Tareas pendientes del calendario de equipo de Recepción: actividades sin
 * fecha todavía definida, compartidas por recepcion/admin/superuser (mismo
 * modelo de visibilidad que `CalendarEventService` — cualquiera de esos
 * roles ve y edita cualquier tarea, no sólo la propia). El guard de rol vive
 * en el controller.
 */
@Injectable()
export class CalendarTaskService {
  constructor(private readonly prisma: PrismaService) {}

  private select() {
    return {
      id: true,
      title: true,
      description: true,
      completed: true,
      completedAt: true,
      createdById: true,
      createdAt: true,
      createdBy: {
        select: { id: true, firstName: true, lastName: true, username: true },
      },
    } satisfies Prisma.CalendarTaskSelect;
  }

  async create(dto: CreateCalendarTaskDto, createdById: number) {
    return this.prisma.calendarTask.create({
      data: {
        title: dto.title,
        description: dto.description,
        createdById,
      },
      select: this.select(),
    });
  }

  /** Todas las tareas, más recientes primero (sin paginar: es una lista corta de pendientes). */
  async findAll() {
    return this.prisma.calendarTask.findMany({
      select: this.select(),
      orderBy: { createdAt: 'desc' },
    });
  }

  private async findOrThrow(id: number) {
    const task = await this.prisma.calendarTask.findUnique({
      where: { id },
      select: this.select(),
    });
    if (!task) {
      throw new HttpException('La tarea no existe', HttpStatus.NOT_FOUND);
    }
    return task;
  }

  async update(id: number, dto: UpdateCalendarTaskDto) {
    await this.findOrThrow(id);
    return this.prisma.calendarTask.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
      select: this.select(),
    });
  }

  async setCompleted(id: number, completed: boolean) {
    await this.findOrThrow(id);
    return this.prisma.calendarTask.update({
      where: { id },
      data: { completed, completedAt: completed ? new Date() : null },
      select: this.select(),
    });
  }

  async remove(id: number) {
    await this.findOrThrow(id);
    await this.prisma.calendarTask.delete({ where: { id } });
    return { success: true };
  }
}
