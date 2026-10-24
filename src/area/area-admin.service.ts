import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AreaTaskStatus, Prisma } from '@prisma/client';
import * as bcryptjs from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  AREA_SLUG_MAX_LENGTH,
  AREA_SLUG_PATTERN,
  DESIGN_AREA,
  RESERVED_AREA_SLUGS,
  slugifyAreaName,
} from './area-access';
import { AREA_SELECT, AreaService, type AreaView } from './area.service';
import { CreateAreaDto } from './dto/create-area.dto';
import { UpdateAreaDto } from './dto/update-area.dto';

/** Estados con los que un pedido ya no es trabajo en curso. */
const CLOSED_STATUS_NAMES = ['entregado', 'cancelado'];

/** Trabajo abierto de un área: lo que se vería afectado al desactivarla. */
export interface AreaOpenWork {
  openOrders: number;
  openTasks: number;
}

/** Un área con lo que el panel de administración necesita saber de ella. */
export interface AreaOverview extends AreaView, AreaOpenWork {
  users: number;
  hasSharedAccount: boolean;
}

export interface CreatedArea extends AreaView {
  /** Id de la cuenta compartida creada, si se pidió. */
  sharedAccountId: number | null;
  /** Usuarios que pasaron a trabajar en el área. */
  userCount: number;
}

/**
 * Administración de áreas (wizard de alta, edición y desactivación).
 * Las lecturas del catálogo viven en `AreaService`; aquí sólo se escribe, y
 * cada escritura invalida su caché y queda en la bitácora de auditoría.
 *
 * Un área nunca se borra: sus pedidos, tareas e inventario guardan el slug.
 * Desactivarla la oculta (no se ofrece como destino ni da acceso) y se
 * rechaza mientras tenga trabajo abierto.
 */
@Injectable()
export class AreaAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly areaService: AreaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Todas las áreas (también las desactivadas) con usuarios y trabajo abierto. */
  async overview(): Promise<AreaOverview[]> {
    const [areas, tasks, orders] = await Promise.all([
      this.prisma.area.findMany({
        select: {
          ...AREA_SELECT,
          _count: { select: { users: true } },
          users: {
            where: { isSharedAccount: true },
            select: { id: true },
            take: 1,
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.orderAreaTask.groupBy({
        by: ['area'],
        where: {
          status: { not: AreaTaskStatus.terminado },
          order: { status: { name: { notIn: CLOSED_STATUS_NAMES } } },
        },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['area'],
        where: {
          area: { not: null },
          status: { name: { notIn: CLOSED_STATUS_NAMES } },
        },
        _count: { _all: true },
      }),
    ]);
    const tasksBy = new Map(tasks.map((t) => [t.area, t._count._all]));
    const ordersBy = new Map(orders.map((o) => [o.area, o._count._all]));
    return areas.map(({ _count, users, ...area }) => ({
      ...area,
      users: _count.users,
      hasSharedAccount: users.length > 0,
      openTasks: tasksBy.get(area.slug) ?? 0,
      openOrders: ordersBy.get(area.slug) ?? 0,
    }));
  }

  async create(dto: CreateAreaDto, actorUserId: number): Promise<CreatedArea> {
    const name = dto.name.trim();
    const slug = this.slugFor(name);
    const sharedAccount = dto.createSharedAccount ?? true;
    const userIds = [...new Set(dto.userIds ?? [])];

    await this.assertNameFree(name, slug);
    if (sharedAccount) await this.assertUsernameFree(slug);
    if (userIds.length > 0) {
      const found = await this.prisma.user.count({
        where: { id: { in: userIds } },
      });
      if (found !== userIds.length) {
        throw new BadRequestException('Uno de los usuarios elegidos no existe');
      }
    }

    const password = sharedAccount
      ? // Sin contraseña conocida: la cuenta compartida existe para asignar
        // trabajo, no para iniciar sesión (igual que las del seed).
        await bcryptjs.hash(randomBytes(32).toString('hex'), 10)
      : null;

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const { _max } = await tx.area.aggregate({ _max: { sortOrder: true } });
        const area = await tx.area.create({
          data: {
            slug,
            name,
            icon: dto.icon,
            color: dto.color.toLowerCase(),
            isProductionDestination: dto.isProductionDestination ?? true,
            hasInventory: dto.hasInventory ?? true,
            generalViewEnabled: dto.generalViewEnabled ?? true,
            inventoryCategories: dto.inventoryCategories ?? [],
            inventoryUnits: dto.inventoryUnits ?? [],
            sortOrder: (_max.sortOrder ?? 0) + 10,
            ...(userIds.length > 0 && {
              users: { connect: userIds.map((id) => ({ id })) },
            }),
          },
          select: AREA_SELECT,
        });
        const account = password
          ? await tx.user.create({
              data: {
                firstName: name,
                username: slug,
                password,
                isSharedAccount: true,
                areas: { connect: { id: area.id } },
              },
              select: { id: true },
            })
          : null;
        return { area, sharedAccountId: account?.id ?? null };
      });
      this.areaService.invalidate();
      await this.auditLog.record({
        actorUserId,
        action: 'area.create',
        entityType: 'area',
        entityId: created.area.id,
        metadata: {
          slug,
          name,
          sharedAccountId: created.sharedAccountId,
          userIds,
        },
      });
      return {
        ...created.area,
        sharedAccountId: created.sharedAccountId,
        userCount: userIds.length + (created.sharedAccountId ? 1 : 0),
      };
    } catch (error) {
      // Carrera con otro alta del mismo nombre o usuario.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe un área con ese nombre');
      }
      throw error;
    }
  }

  async update(
    id: number,
    dto: UpdateAreaDto,
    actorUserId: number,
  ): Promise<AreaView> {
    const current = await this.prisma.area.findUnique({
      where: { id },
      select: AREA_SELECT,
    });
    if (!current) throw new NotFoundException('El área no existe');

    if (current.isDesign) {
      if (dto.active === false) {
        throw new BadRequestException(
          'Diseño es la fase previa de todos los pedidos con montaje: no se puede desactivar',
        );
      }
      if (dto.isProductionDestination === true) {
        throw new BadRequestException(
          'Diseño no es destino de producción: tiene su propio circuito',
        );
      }
    }

    const name = dto.name?.trim();
    if (name !== undefined && name !== current.name) {
      await this.assertNameFree(name, current.slug, id);
    }

    const deactivating = dto.active === false && current.active;
    const leavingProduction =
      dto.isProductionDestination === false && current.isProductionDestination;
    if (deactivating || leavingProduction) {
      await this.assertNoOpenWork(
        current.slug,
        deactivating
          ? 'desactivar el área'
          : 'quitar el área como destino de producción',
      );
    }

    const data: Prisma.AreaUpdateInput = {
      ...(name !== undefined && { name }),
      ...(dto.icon !== undefined && { icon: dto.icon }),
      ...(dto.color !== undefined && { color: dto.color.toLowerCase() }),
      ...(dto.isProductionDestination !== undefined && {
        isProductionDestination: dto.isProductionDestination,
      }),
      ...(dto.hasInventory !== undefined && { hasInventory: dto.hasInventory }),
      ...(dto.generalViewEnabled !== undefined && {
        generalViewEnabled: dto.generalViewEnabled,
      }),
      ...(dto.inventoryCategories !== undefined && {
        inventoryCategories: dto.inventoryCategories,
      }),
      ...(dto.inventoryUnits !== undefined && {
        inventoryUnits: dto.inventoryUnits,
      }),
      ...(dto.active !== undefined && { active: dto.active }),
    };

    try {
      const updated = await this.prisma.area.update({
        where: { id },
        data,
        select: AREA_SELECT,
      });
      this.areaService.invalidate();
      await this.auditLog.record({
        actorUserId,
        action: deactivating
          ? 'area.deactivate'
          : dto.active === true && !current.active
            ? 'area.activate'
            : 'area.update',
        entityType: 'area',
        entityId: id,
        metadata: { slug: current.slug, changes: dto },
      });
      return updated;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe un área con ese nombre');
      }
      throw error;
    }
  }

  /** Slug del nombre, validado (formato y nombres reservados). */
  private slugFor(name: string): string {
    const slug = slugifyAreaName(name);
    if (
      slug.length < 2 ||
      slug.length > AREA_SLUG_MAX_LENGTH ||
      !AREA_SLUG_PATTERN.test(slug)
    ) {
      throw new BadRequestException(
        'El nombre debe tener al menos dos letras o números',
      );
    }
    if ((RESERVED_AREA_SLUGS as readonly string[]).includes(slug)) {
      throw new BadRequestException(
        `"${name}" es un nombre reservado del sistema: elige otro`,
      );
    }
    if (slug === DESIGN_AREA) {
      throw new ConflictException('Ya existe el área Diseño');
    }
    return slug;
  }

  /** El nombre (sin importar mayúsculas) y el slug no pueden repetirse. */
  private async assertNameFree(name: string, slug: string, exceptId?: number) {
    const clash = await this.prisma.area.findFirst({
      where: {
        ...(exceptId !== undefined && { id: { not: exceptId } }),
        OR: [{ slug }, { name: { equals: name, mode: 'insensitive' } }],
      },
      select: { name: true },
    });
    if (clash) {
      throw new ConflictException(
        `Ya existe un área parecida: "${clash.name}"`,
      );
    }
  }

  private async assertUsernameFree(username: string) {
    const taken = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(
        `Ya existe un usuario "${username}": no se puede crear la cuenta compartida del área con ese nombre`,
      );
    }
  }

  /** Pedidos y tareas sin cerrar de un área. */
  async openWork(slug: string): Promise<AreaOpenWork> {
    const [openOrders, openTasks] = await Promise.all([
      this.prisma.order.count({
        where: {
          area: slug,
          status: { name: { notIn: CLOSED_STATUS_NAMES } },
        },
      }),
      this.prisma.orderAreaTask.count({
        where: {
          area: slug,
          status: { not: AreaTaskStatus.terminado },
          order: { status: { name: { notIn: CLOSED_STATUS_NAMES } } },
        },
      }),
    ]);
    return { openOrders, openTasks };
  }

  private async assertNoOpenWork(slug: string, action: string) {
    const { openOrders, openTasks } = await this.openWork(slug);
    if (openOrders > 0 || openTasks > 0) {
      const parts = [
        openOrders > 0 &&
          `${openOrders} pedido${openOrders === 1 ? '' : 's'} abierto${openOrders === 1 ? '' : 's'}`,
        openTasks > 0 &&
          `${openTasks} tarea${openTasks === 1 ? '' : 's'} sin terminar`,
      ].filter(Boolean);
      throw new ConflictException(
        `No se puede ${action}: tiene ${parts.join(' y ')}. Termínalos o reasígnalos primero`,
      );
    }
  }
}
