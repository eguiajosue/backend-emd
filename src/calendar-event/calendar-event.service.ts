import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AreaTaskStatus, CalendarEventCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';
import { CalendarEventQueryDto } from './dto/calendar-event-query.dto';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Título fijo del evento auto-generado — se usa también para reconocerlo (no duplicarlo). */
const MATERIALS_PURCHASE_TITLE = 'Compra de materiales';

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
      orderId: true,
      category: true,
      area: true,
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
    const created = await this.prisma.calendarEvent.create({
      data: {
        title: dto.title,
        clientName: dto.clientName,
        clientId: dto.clientId,
        orderId: dto.orderId,
        category: dto.category,
        area: dto.area,
        eventDate: new Date(dto.eventDate),
        hasTime: dto.hasTime ?? true,
        reminderMinutesBefore: dto.reminderMinutesBefore,
        createdById,
      },
      select: this.select(),
    });

    // Instalación de un pedido -> avisar con una semana de anticipación que
    // hay que comprar los materiales de ese pedido (checklist con lo cargado
    // en su hoja de materiales). Si ya existe uno para este pedido, no se
    // duplica (puede haberse creado ya al cargar el primer material).
    if (created.category === CalendarEventCategory.instalacion && dto.orderId) {
      await this.ensureMaterialsPurchaseEvent(
        dto.orderId,
        created.eventDate,
        createdById,
      );
    }

    return created;
  }

  /**
   * Crea (si no existe todavía) el evento "Compra de materiales" de un
   * pedido, una semana antes de `anchorDate` (fecha de entrega o de la
   * instalación, según quién dispare la creación). La fecha queda como
   * cualquier otra: editable a mano después.
   */
  async ensureMaterialsPurchaseEvent(
    orderId: number,
    anchorDate: Date,
    createdById: number,
  ) {
    const existing = await this.prisma.calendarEvent.findFirst({
      where: { orderId, category: CalendarEventCategory.compras },
      select: { id: true },
    });
    if (existing) return;

    await this.prisma.calendarEvent.create({
      data: {
        title: MATERIALS_PURCHASE_TITLE,
        orderId,
        category: CalendarEventCategory.compras,
        eventDate: new Date(anchorDate.getTime() - WEEK_MS),
        hasTime: false,
        createdById,
      },
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
        ...(dto.orderId !== undefined && { orderId: dto.orderId }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.area !== undefined && { area: dto.area }),
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
