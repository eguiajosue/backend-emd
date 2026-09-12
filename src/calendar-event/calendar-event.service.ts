import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AreaTaskStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';
import { CalendarEventQueryDto } from './dto/calendar-event-query.dto';

/**
 * Transiciones válidas del mismo ciclo corto que `OrderAreaTaskService`: no
 * se puede saltar de pendiente a terminado sin pasar por en_proceso, y se
 * puede retroceder un paso para corregir un clic.
 */
const ALLOWED_TRANSITIONS: Record<AreaTaskStatus, AreaTaskStatus[]> = {
  [AreaTaskStatus.pendiente]: [AreaTaskStatus.en_proceso],
  [AreaTaskStatus.en_proceso]: [
    AreaTaskStatus.terminado,
    AreaTaskStatus.pendiente,
  ],
  [AreaTaskStatus.terminado]: [AreaTaskStatus.en_proceso],
};

/**
 * Calendario de equipo de Recepción: eventos con fecha/hora (instalaciones,
 * juntas, visitas a clientes) compartidos por recepcion/admin/superuser —
 * cualquiera de esos roles ve y edita cualquier evento, no sólo el propio
 * (WORKFLOW: reemplaza la lista a mano por WhatsApp). El guard de rol vive en
 * el controller; este servicio no vuelve a chequear "dueño" del evento.
 */
@Injectable()
export class CalendarEventService {
  constructor(private readonly prisma: PrismaService) {}

  private select() {
    return {
      id: true,
      title: true,
      clientName: true,
      clientId: true,
      category: true,
      eventDate: true,
      hasTime: true,
      status: true,
      reminderMinutesBefore: true,
      createdById: true,
      createdAt: true,
      client: {
        select: { id: true, first_name: true, last_name: true },
      },
      createdBy: {
        select: { id: true, firstName: true, lastName: true, username: true },
      },
    } satisfies Prisma.CalendarEventSelect;
  }

  async create(dto: CreateCalendarEventDto, createdById: number) {
    return this.prisma.calendarEvent.create({
      data: {
        title: dto.title,
        clientName: dto.clientName,
        clientId: dto.clientId,
        category: dto.category,
        eventDate: new Date(dto.eventDate),
        hasTime: dto.hasTime ?? true,
        reminderMinutesBefore: dto.reminderMinutesBefore,
        createdById,
      },
      select: this.select(),
    });
  }

  /** Eventos en un rango (por defecto, sin filtro: todo el calendario). */
  async findAll(query: CalendarEventQueryDto) {
    return this.prisma.calendarEvent.findMany({
      where: {
        eventDate: {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lte: new Date(query.to) }),
        },
      },
      select: this.select(),
      orderBy: { eventDate: 'asc' },
    });
  }

  private async findOrThrow(id: number) {
    const event = await this.prisma.calendarEvent.findUnique({
      where: { id },
      select: this.select(),
    });
    if (!event) {
      throw new HttpException('El evento no existe', HttpStatus.NOT_FOUND);
    }
    return event;
  }

  async findOne(id: number) {
    return this.findOrThrow(id);
  }

  async update(id: number, dto: UpdateCalendarEventDto) {
    await this.findOrThrow(id);
    return this.prisma.calendarEvent.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.clientName !== undefined && { clientName: dto.clientName }),
        ...(dto.clientId !== undefined && { clientId: dto.clientId }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.eventDate !== undefined && {
          eventDate: new Date(dto.eventDate),
        }),
        ...(dto.hasTime !== undefined && { hasTime: dto.hasTime }),
        ...(dto.reminderMinutesBefore !== undefined && {
          reminderMinutesBefore: dto.reminderMinutesBefore,
          // Cambiar la anticipación pedida habilita mandarlo de nuevo.
          reminderSentAt: null,
        }),
      },
      select: this.select(),
    });
  }

  async updateStatus(id: number, status: AreaTaskStatus) {
    const event = await this.findOrThrow(id);
    this.assertValidTransition(event.status, status);
    return this.prisma.calendarEvent.update({
      where: { id },
      data: { status },
      select: this.select(),
    });
  }

  async remove(id: number) {
    await this.findOrThrow(id);
    await this.prisma.calendarEvent.delete({ where: { id } });
    return { success: true };
  }

  private assertValidTransition(current: AreaTaskStatus, next: AreaTaskStatus) {
    if (current === next) return;
    if (!ALLOWED_TRANSITIONS[current].includes(next)) {
      throw new HttpException(
        `No se puede pasar de "${current}" a "${next}"`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
