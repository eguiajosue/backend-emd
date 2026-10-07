import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryMovementType,
  Prisma,
  RestockRequestStatus,
  RestockRequestUrgency,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { AccessTokenPayload } from '../auth/auth.service';
import { isFullVisibilityRole } from '../order/role-stage-mapping';
import { toCsv } from '../common/utils/csv';
import {
  BARCODE_MAX_LENGTH,
  BARCODE_MIN_LENGTH,
  BARCODE_PATTERN,
  INVENTORY_AREAS,
  InventoryArea,
  InventoryStockStatus,
  RESERVED_BARCODE_PATTERN,
  defaultBarcode,
} from './inventory.constants';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { CreateInventoryMovementDto } from './dto/create-inventory-movement.dto';
import {
  CreateRestockRequestDto,
  RestockRequestsQueryDto,
  UpdateRestockRequestStatusDto,
} from './dto/restock-request.dto';

/** Origen de un movimiento en la bitácora. */
export type InventoryMovementSource = 'recepcion' | 'area' | 'scan' | 'inicial';

/** Filtros de la bitácora de movimientos. */
export interface InventoryMovementsFilter {
  itemId?: number;
  area?: string;
  userId?: number;
  type?: InventoryMovementType;
  from?: string;
  to?: string;
  limit?: number;
}

type Actor = Pick<AccessTokenPayload, 'sub' | 'roles'>;

export const AREA_LABELS: Record<InventoryArea, string> = {
  taller: 'Taller',
  dtf: 'DTF',
  bordado: 'Bordado',
  diseno: 'Diseño',
  laser: 'Láser',
  impresiones: 'Impresiones',
  recepcion: 'Recepción',
};

const ITEM_SELECT = {
  id: true,
  area: true,
  name: true,
  sku: true,
  barcode: true,
  category: true,
  unit: true,
  color: true,
  brand: true,
  location: true,
  quantity: true,
  minStock: true,
  unitCost: true,
  notes: true,
  materialId: true,
  supplierId: true,
  createdAt: true,
  updatedAt: true,
  material: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
} satisfies Prisma.InventoryItemSelect;

type ItemRow = Prisma.InventoryItemGetPayload<{ select: typeof ITEM_SELECT }>;

const MOVEMENT_SELECT = {
  id: true,
  itemId: true,
  type: true,
  delta: true,
  balanceAfter: true,
  unitCost: true,
  note: true,
  orderId: true,
  balanceBefore: true,
  area: true,
  reason: true,
  source: true,
  createdAt: true,
  item: { select: { id: true, name: true, unit: true, area: true } },
  order: { select: { id: true, description: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.InventoryMovementSelect;

type MovementRow = Prisma.InventoryMovementGetPayload<{
  select: typeof MOVEMENT_SELECT;
}>;

const RESTOCK_SELECT = {
  id: true,
  area: true,
  itemId: true,
  itemName: true,
  quantity: true,
  unit: true,
  comment: true,
  urgency: true,
  status: true,
  statusNote: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
  item: {
    select: { id: true, name: true, unit: true, quantity: true, area: true },
  },
  requestedBy: { select: { id: true, firstName: true, lastName: true } },
  handledBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.RestockRequestSelect;

type RestockRow = Prisma.RestockRequestGetPayload<{
  select: typeof RESTOCK_SELECT;
}>;

export const RESTOCK_STATUS_LABELS: Record<RestockRequestStatus, string> = {
  PENDIENTE: 'Pendiente',
  EN_CAMINO: 'En camino',
  COMPRADO: 'Comprado',
  RESUELTO: 'Resuelto',
};

/** Fecha `YYYY-MM-DD` sin hora: como límite superior incluye todo ese día. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const fullName = (user: { firstName: string; lastName: string } | null) =>
  user ? `${user.firstName} ${user.lastName}`.trim() : '';

const toNumber = (value: Prisma.Decimal | null) =>
  value === null ? null : Number(value);

/** Texto opcional: "" borra el valor (null); undefined lo deja como está. */
const optionalText = (value: string | undefined) =>
  value === undefined ? undefined : value === '' ? null : value;

/**
 * Recorta y valida un código de barras (Code 128: 3..64 caracteres ASCII
 * imprimibles). Los `EMD-<número>` están reservados para el código por
 * omisión; sólo se aceptan si son justo el de este artículo (`ownId`).
 */
export function normalizeBarcode(raw: string, ownId?: number): string {
  const code = raw.trim();
  if (code.length < BARCODE_MIN_LENGTH || code.length > BARCODE_MAX_LENGTH) {
    throw new BadRequestException(
      `El código de barras debe tener entre ${BARCODE_MIN_LENGTH} y ${BARCODE_MAX_LENGTH} caracteres`,
    );
  }
  if (!BARCODE_PATTERN.test(code)) {
    throw new BadRequestException(
      'El código de barras sólo admite letras sin acentos, números, espacios y símbolos ASCII',
    );
  }
  if (
    RESERVED_BARCODE_PATTERN.test(code) &&
    (ownId === undefined || code !== defaultBarcode(ownId))
  ) {
    throw new BadRequestException(
      'Los códigos EMD-<número> los asigna el sistema; deja el campo vacío para usar el automático',
    );
  }
  return code;
}

export function stockStatusOf(
  quantity: number,
  minStock: number | null,
): InventoryStockStatus {
  if (quantity <= 0) return 'out';
  if (minStock !== null && quantity <= minStock) return 'low';
  return 'ok';
}

/**
 * Inventario por departamento: existencias físicas de cada área y su kardex.
 *
 * Distinto del catálogo de Materiales (ver `Material`): un artículo puede
 * vincularse a un material del catálogo, pero muchos consumibles (hilos de
 * bordado, tintas) sólo existen aquí.
 *
 * Acceso: admin/superuser/recepción ven y gestionan (crean, editan, borran,
 * ajustan y consultan la bitácora) todos los departamentos. Cada rol de
 * producción (taller, dtf, bordado, láser, impresiones) sólo ve los artículos
 * de su(s) área(s) y puede registrar entradas y consumos de ellos y avisar
 * que algo requiere reabasto; cada uno de esos cambios avisa a Recepción.
 * Un artículo de otra área da 403 (por id) o 404 (por código de barras).
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  /** Departamentos cuyo inventario puede ver/gestionar este usuario. */
  areasFor(roles: string[] | undefined): InventoryArea[] {
    if (isFullVisibilityRole(roles)) return [...INVENTORY_AREAS];
    return INVENTORY_AREAS.filter((area) => roles?.includes(area));
  }

  private assertArea(actor: Actor, area: string) {
    if (!this.areasFor(actor.roles).includes(area as InventoryArea)) {
      throw new ForbiddenException(
        'No tienes acceso al inventario de ese departamento',
      );
    }
  }

  /**
   * Crear, editar, borrar y mover stock es sólo para admin/superuser/
   * recepción: las áreas consultan su inventario en modo lectura.
   */
  private assertCanManage(actor: Actor) {
    if (!isFullVisibilityRole(actor.roles)) {
      throw new ForbiddenException(
        'Sólo administración o Recepción pueden modificar el inventario',
      );
    }
  }

  private isManager(actor: Actor) {
    return isFullVisibilityRole(actor.roles);
  }

  /** Áreas a consultar: la pedida (si tiene acceso) o todas las suyas. */
  private scopeAreas(actor: Actor, area?: string): string[] {
    if (area) {
      this.assertArea(actor, area);
      return [area];
    }
    return this.areasFor(actor.roles);
  }

  private serializeItem(item: ItemRow) {
    const quantity = Number(item.quantity);
    const minStock = toNumber(item.minStock);
    const unitCost = toNumber(item.unitCost);
    return {
      ...item,
      quantity,
      minStock,
      unitCost,
      stockStatus: stockStatusOf(quantity, minStock),
      totalValue: unitCost === null ? null : quantity * unitCost,
    };
  }

  private serializeMovement(movement: MovementRow) {
    return {
      ...movement,
      delta: Number(movement.delta),
      balanceAfter: Number(movement.balanceAfter),
      balanceBefore: toNumber(movement.balanceBefore),
      unitCost: toNumber(movement.unitCost),
    };
  }

  private async findRowOrThrow(id: number) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
      select: ITEM_SELECT,
    });
    if (!item) throw new NotFoundException('El artículo no existe');
    return item;
  }

  /**
   * 409 si el código ya lo tiene OTRO artículo (de cualquier departamento:
   * quien edita inventario los ve todos), con su nombre para ubicarlo.
   */
  private async assertBarcodeFree(code: string, exceptId?: number) {
    const owner = await this.prisma.inventoryItem.findUnique({
      where: { barcode: code },
      select: { id: true, name: true },
    });
    if (owner && owner.id !== exceptId) {
      throw new ConflictException(
        `Ese código ya está asignado a ${owner.name}`,
      );
    }
  }

  private rethrowUnique(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      // Carrera entre la verificación previa y la escritura.
      const target = error.meta?.target;
      if (
        (Array.isArray(target) && target.includes('barcode')) ||
        (typeof target === 'string' && target.includes('barcode'))
      ) {
        throw new ConflictException(
          'Ese código ya está asignado a otro artículo',
        );
      }
      throw new ConflictException(
        'Ya hay un artículo con ese código (SKU) en este departamento',
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2003'
    ) {
      throw new BadRequestException(
        'El material, proveedor o pedido indicado no existe',
      );
    }
    throw error;
  }

  async findAll(actor: Actor, area?: string) {
    const areas = this.scopeAreas(actor, area);
    const items = await this.prisma.inventoryItem.findMany({
      where: { area: { in: areas } },
      select: ITEM_SELECT,
      orderBy: [{ area: 'asc' }, { name: 'asc' }],
    });
    return items.map((item) => this.serializeItem(item));
  }

  async findOne(id: number, actor: Actor) {
    const item = await this.findRowOrThrow(id);
    this.assertArea(actor, item.area);
    return this.serializeItem(item);
  }

  /**
   * Busca un artículo por su código de barras (escaneo). Un código que no
   * existe o que es de un departamento que el usuario no ve da el mismo 404,
   * para no revelar artículos ajenos.
   */
  async findByBarcode(rawCode: string, actor: Actor) {
    const code = rawCode.trim();
    if (
      code.length < BARCODE_MIN_LENGTH ||
      code.length > BARCODE_MAX_LENGTH ||
      !BARCODE_PATTERN.test(code)
    ) {
      throw new BadRequestException(
        `Código de barras inválido: ${code.slice(0, BARCODE_MAX_LENGTH)}`,
      );
    }
    const item = await this.prisma.inventoryItem.findUnique({
      where: { barcode: code },
      select: ITEM_SELECT,
    });
    if (
      !item ||
      !this.areasFor(actor.roles).includes(item.area as InventoryArea)
    ) {
      throw new NotFoundException(
        `No hay ningún artículo con el código ${code}`,
      );
    }
    return this.serializeItem(item);
  }

  /**
   * Escaneo en modo Entrada/Salida en una sola petición: ubica el artículo
   * por su código y registra el movimiento con la misma lógica (y permisos)
   * que `POST /inventory/:id/movements`.
   */
  async registerMovementByBarcode(
    rawCode: string,
    dto: CreateInventoryMovementDto,
    actor: Actor,
  ) {
    const item = await this.findByBarcode(rawCode, actor);
    return this.registerMovement(item.id, dto, actor, 'scan');
  }

  async create(dto: CreateInventoryItemDto, actor: Actor) {
    this.assertCanManage(actor);
    this.assertArea(actor, dto.area);
    const initial = dto.initialQuantity ?? 0;
    const customBarcode =
      dto.barcode === undefined || dto.barcode === null || dto.barcode === ''
        ? null
        : normalizeBarcode(dto.barcode);
    if (customBarcode) await this.assertBarcodeFree(customBarcode);
    try {
      const item = await this.prisma.$transaction(async (tx) => {
        const created = await tx.inventoryItem.create({
          data: {
            area: dto.area,
            name: dto.name,
            sku: optionalText(dto.sku),
            category: optionalText(dto.category),
            unit: dto.unit,
            color: optionalText(dto.color),
            brand: optionalText(dto.brand),
            location: optionalText(dto.location),
            notes: optionalText(dto.notes),
            minStock: dto.minStock ?? null,
            unitCost: dto.unitCost ?? null,
            materialId: dto.materialId ?? null,
            supplierId: dto.supplierId ?? null,
            quantity: initial,
            barcode: customBarcode,
          },
          select: { id: true },
        });
        // Sin código propio: el de omisión depende del id, que se conoce
        // hasta insertar. Misma transacción, así nunca queda sin código.
        if (!customBarcode) {
          await tx.inventoryItem.update({
            where: { id: created.id },
            data: { barcode: defaultBarcode(created.id) },
            select: { id: true },
          });
        }
        if (initial > 0) {
          await tx.inventoryMovement.create({
            data: {
              itemId: created.id,
              type: InventoryMovementType.ENTRADA,
              delta: initial,
              balanceAfter: initial,
              unitCost: dto.unitCost ?? null,
              note: 'Stock inicial',
              balanceBefore: 0,
              area: dto.area,
              reason: 'Stock inicial',
              source: 'inicial',
              createdById: actor.sub,
            },
          });
        }
        return tx.inventoryItem.findUniqueOrThrow({
          where: { id: created.id },
          select: ITEM_SELECT,
        });
      });
      return this.serializeItem(item);
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async update(id: number, dto: UpdateInventoryItemDto, actor: Actor) {
    this.assertCanManage(actor);
    const before = await this.findRowOrThrow(id);
    this.assertArea(actor, before.area);
    if (dto.area !== undefined && dto.area !== before.area) {
      this.assertArea(actor, dto.area);
    }
    // undefined: no se toca; null / "": vuelve al código por omisión.
    let barcode: string | undefined;
    if (dto.barcode !== undefined) {
      barcode =
        dto.barcode === null || dto.barcode === ''
          ? defaultBarcode(id)
          : normalizeBarcode(dto.barcode, id);
      if (barcode !== before.barcode) await this.assertBarcodeFree(barcode, id);
    }
    try {
      const item = await this.prisma.inventoryItem.update({
        where: { id },
        data: {
          ...(dto.area !== undefined && { area: dto.area }),
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.unit !== undefined && { unit: dto.unit }),
          sku: optionalText(dto.sku),
          category: optionalText(dto.category),
          color: optionalText(dto.color),
          brand: optionalText(dto.brand),
          location: optionalText(dto.location),
          notes: optionalText(dto.notes),
          ...(dto.minStock !== undefined && { minStock: dto.minStock }),
          ...(dto.unitCost !== undefined && { unitCost: dto.unitCost }),
          ...(dto.materialId !== undefined && { materialId: dto.materialId }),
          ...(dto.supplierId !== undefined && { supplierId: dto.supplierId }),
          ...(barcode !== undefined && { barcode }),
        },
        select: ITEM_SELECT,
      });
      return this.serializeItem(item);
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async remove(id: number, actor: Actor) {
    this.assertCanManage(actor);
    await this.findRowOrThrow(id);
    await this.prisma.inventoryItem.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Registra una entrada/salida/ajuste y lo deja en la bitácora (quién,
   * antes/después, motivo, área y origen). Las áreas de producción sólo
   * registran entradas y consumos de SUS artículos; cada uno avisa a
   * Recepción. Bloquea la fila del artículo
   * (`SELECT ... FOR UPDATE`) para que dos consumos simultáneos no lean el
   * mismo stock y dejen un saldo incorrecto.
   */
  async registerMovement(
    id: number,
    dto: CreateInventoryMovementDto,
    actor: Actor,
    via?: InventoryMovementSource,
  ) {
    const manager = this.isManager(actor);
    if (!manager && dto.type === InventoryMovementType.AJUSTE) {
      throw new ForbiddenException(
        'Las áreas sólo pueden registrar entradas o consumos; el ajuste por conteo es de Recepción',
      );
    }
    const item = await this.findRowOrThrow(id);
    this.assertArea(actor, item.area);
    const source: InventoryMovementSource = manager
      ? (via ?? 'recepcion')
      : 'area';

    if (dto.type !== InventoryMovementType.AJUSTE && dto.quantity <= 0) {
      throw new BadRequestException('La cantidad debe ser mayor a 0');
    }
    if (dto.orderId !== undefined) {
      const order = await this.prisma.order.findUnique({
        where: { id: dto.orderId },
        select: { id: true },
      });
      if (!order) throw new BadRequestException('El pedido no existe');
    }

    const { movement, before, after } = await this.prisma.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<{ quantity: Prisma.Decimal }[]>`
          SELECT "quantity" FROM "InventoryItem" WHERE "id" = ${id} FOR UPDATE`;
        if (!locked) throw new NotFoundException('El artículo no existe');

        const current = new Prisma.Decimal(locked.quantity);
        const amount = new Prisma.Decimal(dto.quantity);
        let delta: Prisma.Decimal;
        switch (dto.type) {
          case InventoryMovementType.ENTRADA:
            delta = amount;
            break;
          case InventoryMovementType.SALIDA:
            if (amount.greaterThan(current)) {
              throw new BadRequestException(
                `Stock insuficiente: hay ${current.toNumber()} ${item.unit}`,
              );
            }
            delta = amount.negated();
            break;
          default:
            delta = amount.minus(current);
        }
        const balance = current.plus(delta);

        await tx.inventoryItem.update({
          where: { id },
          data: {
            quantity: balance,
            ...(dto.type === InventoryMovementType.ENTRADA &&
              dto.unitCost !== undefined && { unitCost: dto.unitCost }),
          },
        });
        const created = await tx.inventoryMovement.create({
          data: {
            itemId: id,
            type: dto.type,
            delta,
            balanceAfter: balance,
            unitCost:
              dto.type === InventoryMovementType.ENTRADA
                ? (dto.unitCost ?? null)
                : null,
            note: dto.note,
            orderId: dto.orderId,
            balanceBefore: current,
            area: item.area,
            reason: dto.reason ?? dto.note ?? null,
            source,
            createdById: actor.sub,
          },
          select: MOVEMENT_SELECT,
        });
        return {
          movement: created,
          before: current.toNumber(),
          after: balance.toNumber(),
        };
      },
    );

    const minStock = toNumber(item.minStock);
    if (
      stockStatusOf(before, minStock) === 'ok' &&
      stockStatusOf(after, minStock) !== 'ok'
    ) {
      void this.notifyLowStock(item, after, actor.sub).catch((error) =>
        this.logger.warn(`No se pudo avisar stock bajo: ${error?.message}`),
      );
    }

    if (!manager) {
      void this.notifyAreaMovement(item, dto.type, before, after, actor).catch(
        (error) =>
          this.logger.warn(
            `No se pudo avisar el movimiento del área: ${error?.message}`,
          ),
      );
    }

    return {
      movement: this.serializeMovement(movement),
      item: this.serializeItem(await this.findRowOrThrow(id)),
    };
  }

  /** Recepción y admin: quienes compran y atienden el inventario. */
  private async managerRecipients(exceptUserId: number) {
    const audiences = await Promise.all(
      ['recepcion', 'admin'].map((role) =>
        this.notificationService.userIdsForArea(role),
      ),
    );
    return [...new Set(audiences.flat())].filter((id) => id !== exceptUserId);
  }

  private async actorName(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    return fullName(user) || `Usuario ${userId}`;
  }

  /** Entrada o consumo que registró un área: Recepción se entera al momento. */
  private async notifyAreaMovement(
    item: ItemRow,
    type: InventoryMovementType,
    before: number,
    after: number,
    actor: Actor,
  ) {
    const recipients = await this.managerRecipients(actor.sub);
    const areaLabel = AREA_LABELS[item.area as InventoryArea] ?? item.area;
    const who = await this.actorName(actor.sub);
    const amount = Math.abs(after - before);
    await this.notificationService.createNotificationForUsers(recipients, {
      type: 'inventory_area_movement',
      title:
        type === InventoryMovementType.ENTRADA
          ? `Entrada en ${areaLabel}: ${item.name}`
          : `Consumo en ${areaLabel}: ${item.name}`,
      body: `${who} ${
        type === InventoryMovementType.ENTRADA ? 'sumó' : 'descontó'
      } ${amount} ${item.unit} · ${before} → ${after}`,
    });
  }

  /**
   * Avisa al departamento dueño y a quien compra (Recepción/admin) cuando un
   * artículo CRUZA el punto de reorden o se agota. Sólo en el cruce, no en
   * cada consumo posterior, para no llenar la campana de avisos repetidos.
   */
  private async notifyLowStock(item: ItemRow, after: number, actorId: number) {
    const recipients = await this.managerRecipients(actorId);
    const areaLabel = AREA_LABELS[item.area as InventoryArea] ?? item.area;
    await this.notificationService.createNotificationForUsers(recipients, {
      type: 'inventory_low_stock',
      title:
        after <= 0
          ? `Agotado: ${item.name} (${areaLabel})`
          : `Stock bajo: ${item.name} (${areaLabel})`,
      body: `Quedan ${after} ${item.unit}${
        item.minStock !== null ? ` · mínimo ${Number(item.minStock)}` : ''
      }`,
    });
  }

  /**
   * Bitácora de movimientos (sólo Recepción/admin, ver controlador): por
   * artículo, o global filtrable por área, usuario, tipo y fechas. El área
   * es la que tenía el artículo al moverse.
   */
  async findMovements(actor: Actor, filter: InventoryMovementsFilter) {
    const where: Prisma.InventoryMovementWhereInput = {};
    if (filter.itemId !== undefined) {
      const item = await this.findRowOrThrow(filter.itemId);
      this.assertArea(actor, item.area);
      where.itemId = filter.itemId;
    }
    const areas = this.scopeAreas(actor, filter.area);
    if (filter.itemId === undefined || filter.area) {
      where.OR = [
        { area: { in: areas } },
        { area: null, item: { area: { in: areas } } },
      ];
    }
    if (filter.userId !== undefined) where.createdById = filter.userId;
    if (filter.type !== undefined) where.type = filter.type;
    if (filter.from || filter.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (filter.from) createdAt.gte = new Date(filter.from);
      if (filter.to) {
        const to = new Date(filter.to);
        if (DATE_ONLY.test(filter.to)) {
          to.setUTCDate(to.getUTCDate() + 1);
          createdAt.lt = to;
        } else {
          createdAt.lte = to;
        }
      }
      where.createdAt = createdAt;
    }
    const movements = await this.prisma.inventoryMovement.findMany({
      where,
      select: MOVEMENT_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit ?? 100,
    });
    return movements.map((m) => this.serializeMovement(m));
  }

  // ─── Solicitudes de reabasto ───────────────────────────────────────────

  private serializeRestock(row: RestockRow) {
    return {
      ...row,
      quantity: toNumber(row.quantity),
      item: row.item
        ? { ...row.item, quantity: Number(row.item.quantity) }
        : null,
    };
  }

  /**
   * Un área avisa que un insumo se acabó o requiere reabasto. Con `itemId`
   * el artículo tiene que ser de un área del usuario; con texto libre se usa
   * `area` (o la única área del usuario). Avisa a Recepción y admin.
   */
  async createRestockRequest(dto: CreateRestockRequestDto, actor: Actor) {
    let area: string;
    let itemName: string;
    let unit = dto.unit ?? null;
    if (dto.itemId !== undefined) {
      const item = await this.findRowOrThrow(dto.itemId);
      this.assertArea(actor, item.area);
      if (dto.area && dto.area !== item.area) {
        throw new BadRequestException(
          'El artículo no pertenece al departamento indicado',
        );
      }
      area = item.area;
      itemName = item.name;
      unit = unit ?? item.unit;
    } else {
      if (!dto.itemName) {
        throw new BadRequestException(
          'Indica el artículo o escribe qué insumo hace falta',
        );
      }
      itemName = dto.itemName;
      if (dto.area) {
        this.assertArea(actor, dto.area);
        area = dto.area;
      } else {
        const own = this.isManager(actor)
          ? ['recepcion']
          : this.areasFor(actor.roles);
        if (own.length !== 1) {
          throw new BadRequestException('Indica de qué departamento es');
        }
        area = own[0];
      }
    }

    const row = await this.prisma.restockRequest.create({
      data: {
        area,
        itemId: dto.itemId ?? null,
        itemName,
        quantity: dto.quantity ?? null,
        unit,
        comment: dto.comment ?? null,
        urgency: dto.urgency ?? RestockRequestUrgency.NORMAL,
        requestedById: actor.sub,
      },
      select: RESTOCK_SELECT,
    });

    void this.notifyRestockCreated(row, actor).catch((error) =>
      this.logger.warn(`No se pudo avisar el reabasto: ${error?.message}`),
    );
    return this.serializeRestock(row);
  }

  private async notifyRestockCreated(row: RestockRow, actor: Actor) {
    const recipients = await this.managerRecipients(actor.sub);
    const areaLabel = AREA_LABELS[row.area as InventoryArea] ?? row.area;
    const qty =
      row.quantity !== null
        ? ` · ${Number(row.quantity)}${row.unit ? ` ${row.unit}` : ''}`
        : '';
    await this.notificationService.createNotificationForUsers(recipients, {
      type: 'inventory_restock_request',
      title: `${
        row.urgency === RestockRequestUrgency.URGENTE ? 'URGENTE · ' : ''
      }Reabasto ${areaLabel}: ${row.itemName}`,
      body: `${fullName(row.requestedBy)}${qty}${
        row.comment ? ` · ${row.comment}` : ''
      }`,
    });
  }

  /**
   * Bandeja de solicitudes. Recepción/admin ven todas; un área ve las de sus
   * departamentos (para seguir el estado de lo que pidió).
   */
  async findRestockRequests(actor: Actor, query: RestockRequestsQueryDto) {
    const where: Prisma.RestockRequestWhereInput = {
      area: { in: this.scopeAreas(actor, query.area) },
    };
    if (query.status) where.status = query.status;
    else if (query.open === 'true')
      where.status = { not: RestockRequestStatus.RESUELTO };
    const rows = await this.prisma.restockRequest.findMany({
      where,
      select: RESTOCK_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 200,
    });
    return rows.map((row) => this.serializeRestock(row));
  }

  /** Para el badge de la pestaña: solicitudes abiertas de lo que el usuario ve. */
  async restockPendingCount(actor: Actor) {
    const pending = await this.prisma.restockRequest.count({
      where: {
        area: { in: this.areasFor(actor.roles) },
        status: RestockRequestStatus.PENDIENTE,
      },
    });
    const open = await this.prisma.restockRequest.count({
      where: {
        area: { in: this.areasFor(actor.roles) },
        status: { not: RestockRequestStatus.RESUELTO },
      },
    });
    return { pending, open };
  }

  /** Recepción/admin cambian el estado; quien pidió recibe el aviso. */
  async updateRestockStatus(
    id: number,
    dto: UpdateRestockRequestStatusDto,
    actor: Actor,
  ) {
    this.assertCanManage(actor);
    const current = await this.prisma.restockRequest.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!current) throw new NotFoundException('La solicitud no existe');
    const row = await this.prisma.restockRequest.update({
      where: { id },
      data: {
        status: dto.status,
        statusNote: dto.note ?? null,
        handledById: actor.sub,
        resolvedAt:
          dto.status === RestockRequestStatus.RESUELTO ? new Date() : null,
      },
      select: RESTOCK_SELECT,
    });
    if (current.status !== dto.status && row.requestedBy.id !== actor.sub) {
      void this.notificationService
        .createNotification({
          userId: row.requestedBy.id,
          type: 'inventory_restock_status',
          title: `Reabasto ${RESTOCK_STATUS_LABELS[dto.status].toLowerCase()}: ${row.itemName}`,
          body: dto.note,
        })
        .catch((error) =>
          this.logger.warn(
            `No se pudo avisar el estado del reabasto: ${error?.message}`,
          ),
        );
    }
    return this.serializeRestock(row);
  }

  async exportCsv(actor: Actor, area?: string) {
    const items = await this.findAll(actor, area);
    const statusLabel: Record<InventoryStockStatus, string> = {
      ok: 'Disponible',
      low: 'Bajo stock',
      out: 'Agotado',
    };
    return toCsv(
      [
        'Departamento',
        'Artículo',
        'SKU',
        'Código de barras',
        'Categoría',
        'Existencia',
        'Unidad',
        'Mínimo',
        'Estado',
        'Costo unitario',
        'Valor',
        'Ubicación',
        'Material del catálogo',
        'Proveedor',
      ],
      items.map((item) => [
        AREA_LABELS[item.area as InventoryArea] ?? item.area,
        item.name,
        item.sku,
        item.barcode,
        item.category,
        item.quantity,
        item.unit,
        item.minStock,
        statusLabel[item.stockStatus],
        item.unitCost,
        item.totalValue?.toFixed(2),
        item.location,
        item.material?.name,
        item.supplier?.name,
      ]),
    );
  }
}
