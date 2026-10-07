import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AreaTaskStatus,
  InventoryMovementType,
  Prisma,
  SupplySource,
} from '@prisma/client';
import { AreaSupplyDto } from './dto/order-area-supply.dto';

/**
 * Hoja de materiales por área (origen de insumos) — WORKFLOW.md §3.
 *
 * - Se captura al autorizar el montaje: por cada tarea de área, Recepción
 *   indica si los insumos los trae el cliente o los ponemos nosotros.
 * - Las líneas "nuestras" ligadas a inventario quedan APARTADAS (disponible =
 *   existencia − apartado) mientras no se descuentan.
 * - Al pasar la tarea a `terminado` se descuentan con una SALIDA por línea
 *   (dentro de la misma transacción que el cambio de estado). El inventario
 *   no admite stock negativo, pero terminar NUNCA se bloquea por falta de
 *   stock: la línea sin existencia se omite (queda apartada, "descuento
 *   pendiente"), Recepción/admin reciben un aviso y la reintentan con
 *   `discountPendingTx` cuando haya entrada de inventario.
 * - Concurrencia: quien cambia el estado (o guarda la hoja) toma primero el
 *   candado de la fila de la tarea (`lockTaskStatusTx`) y cada línea se
 *   "reclama" de forma atómica (`updateMany` sobre `discountedAt`), así dos
 *   transiciones simultáneas nunca descuentan (ni devuelven) dos veces.
 * - Si la tarea regresa de `terminado`, se devuelven con una ENTRADA.
 * - Las líneas del cliente nunca tocan inventario.
 *
 * Todo opera sobre un cliente de transacción (`tx`) que pasa el llamador.
 */
type Tx = Prisma.TransactionClient;

/** Opciones de las transacciones que descuentan/devuelven insumos. */
export const SUPPLY_TX_OPTIONS = { timeout: 20000, maxWait: 10000 } as const;

/** Origen de los movimientos de inventario que genera la hoja de materiales. */
export const SUPPLY_MOVEMENT_SOURCE = 'orden';

/** Línea que no se pudo descontar por falta de existencia. */
export interface PendingSupplyLine {
  lineId: number;
  itemId: number;
  itemName: string;
  unit: string;
  /** Cuánto falta para poder descontarla (cantidad pedida − existencia). */
  missing: number;
}

/** Artículo que cruzó su punto de reorden (o se agotó) con el descuento. */
export interface SupplyLowStockCrossing {
  itemId: number;
  name: string;
  unit: string;
  area: string;
  minStock: number | null;
  after: number;
}

export interface SupplyInventoryResult {
  pending: PendingSupplyLine[];
  lowStock: SupplyLowStockCrossing[];
}

/**
 * Toma el candado de la fila de la tarea (`SELECT ... FOR UPDATE`) y devuelve
 * su estado ACTUAL (null si ya no existe). Quien cambia el estado, guarda la
 * hoja o reintenta descuentos lo llama primero dentro de su transacción para
 * serializarse con los demás y volver a validar contra el estado real.
 */
export async function lockTaskStatusTx(
  tx: Tx,
  taskId: number,
): Promise<AreaTaskStatus | null> {
  const [row] = await tx.$queryRaw<{ status: AreaTaskStatus }[]>`
    SELECT "status" FROM "OrderAreaTask" WHERE "id" = ${taskId} FOR UPDATE`;
  return row?.status ?? null;
}

export const SUPPLY_LINE_SELECT = {
  id: true,
  inventoryItemId: true,
  description: true,
  quantity: true,
  discountedAt: true,
  inventoryItem: {
    select: { id: true, name: true, unit: true, area: true, barcode: true },
  },
} satisfies Prisma.OrderAreaSupplyLineSelect;

/** Lo que viaja con cada tarea de área (tarjetas, detalle, Modo TV). */
export const TASK_SUPPLY_SELECT = {
  select: {
    id: true,
    source: true,
    updatedAt: true,
    lines: { select: SUPPLY_LINE_SELECT, orderBy: { id: 'asc' } },
  },
} satisfies Prisma.OrderAreaTask$supplyArgs;

/** Cantidades Decimal → number para la API. */
export function serializeSupply<
  T extends { lines: { quantity: Prisma.Decimal | number }[] } | null,
>(supply: T) {
  if (!supply) return supply;
  return {
    ...supply,
    lines: supply.lines.map((line) => ({
      ...line,
      quantity: Number(line.quantity),
    })),
  };
}

/** Valida forma y reglas de negocio de la hoja antes de escribir nada. */
export function validateSupplies(supplies: AreaSupplyDto[]) {
  const seen = new Set<string>();
  for (const supply of supplies) {
    if (seen.has(supply.area)) {
      throw new BadRequestException(
        `El área ${supply.area} aparece dos veces en la hoja de materiales`,
      );
    }
    seen.add(supply.area);
    if (supply.source === SupplySource.nosotros && supply.lines.length === 0) {
      throw new BadRequestException(
        `Agrega al menos un insumo para ${supply.area} (o marca que lo trae el cliente)`,
      );
    }
    for (const line of supply.lines) {
      if (
        supply.source === SupplySource.cliente &&
        line.inventoryItemId !== undefined
      ) {
        throw new BadRequestException(
          'Los insumos que trae el cliente no se ligan al inventario',
        );
      }
      if (line.inventoryItemId === undefined && !line.description) {
        throw new BadRequestException(
          'Cada insumo sin artículo de inventario necesita una descripción',
        );
      }
    }
  }
}

/** Apartado por artículo: líneas "nuestras" todavía sin descontar. */
export async function reservedByItem(
  client: Pick<Tx, 'orderAreaSupplyLine'>,
  itemIds: number[],
): Promise<Map<number, number>> {
  const reserved = new Map<number, number>();
  if (itemIds.length === 0) return reserved;
  const lines = await client.orderAreaSupplyLine.findMany({
    where: {
      inventoryItemId: { in: itemIds },
      discountedAt: null,
      supply: { source: SupplySource.nosotros },
    },
    select: { inventoryItemId: true, quantity: true },
  });
  for (const line of lines) {
    const id = line.inventoryItemId as number;
    reserved.set(id, (reserved.get(id) ?? 0) + Number(line.quantity));
  }
  return reserved;
}

/**
 * Guarda (crea o reemplaza) la hoja de las áreas indicadas. Las tareas tienen
 * que existir ya en el pedido. No se puede cambiar la hoja de un área cuyos
 * insumos ya se descontaron (tarea terminada): primero hay que regresarla.
 *
 * Devuelve avisos de stock insuficiente (no bloquean: el bloqueo real es al
 * descontar, porque el inventario no admite negativos).
 */
export async function saveSuppliesTx(
  tx: Tx,
  orderId: number,
  supplies: AreaSupplyDto[],
  userId: number,
): Promise<string[]> {
  validateSupplies(supplies);
  if (supplies.length === 0) return [];

  // Candado de las tareas (en orden de id) ANTES de leerlas: así un PUT no
  // corre contra un "terminado" que está descontando esas mismas líneas.
  await tx.$queryRaw`SELECT "id" FROM "OrderAreaTask" WHERE "orderId" = ${orderId} AND "area" IN (${Prisma.join(
    supplies.map((s) => s.area as string),
  )}) ORDER BY "id" FOR UPDATE`;
  const tasks = await tx.orderAreaTask.findMany({
    where: { orderId, area: { in: supplies.map((s) => s.area) } },
    select: {
      id: true,
      area: true,
      status: true,
      supply: {
        select: {
          id: true,
          source: true,
          lines: {
            select: {
              id: true,
              inventoryItemId: true,
              description: true,
              quantity: true,
              discountedAt: true,
            },
            orderBy: { id: 'asc' },
          },
        },
      },
    },
  });
  const taskByArea = new Map(tasks.map((t) => [t.area, t]));

  const itemIds = [
    ...new Set(
      supplies.flatMap((s) =>
        s.lines
          .map((l) => l.inventoryItemId)
          .filter((id): id is number => id !== undefined),
      ),
    ),
  ];
  const items = itemIds.length
    ? await tx.inventoryItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, name: true, unit: true, quantity: true },
      })
    : [];
  const itemById = new Map(items.map((i) => [i.id, i]));
  const missing = itemIds.filter((id) => !itemById.has(id));
  if (missing.length > 0) {
    throw new BadRequestException(
      `El artículo de inventario #${missing[0]} no existe`,
    );
  }

  for (const supply of supplies) {
    const task = taskByArea.get(supply.area);
    if (!task) {
      throw new BadRequestException(
        `El pedido no tiene tarea de ${supply.area}`,
      );
    }
    const lines = supply.lines.map((line) => ({
      inventoryItemId: line.inventoryItemId ?? null,
      description:
        line.description ??
        itemById.get(line.inventoryItemId as number)?.name ??
        '',
      quantity: new Prisma.Decimal(line.quantity),
    }));
    const unchanged =
      !!task.supply &&
      task.supply.source === supply.source &&
      task.supply.lines.length === lines.length &&
      task.supply.lines.every(
        (old, i) =>
          old.inventoryItemId === lines[i].inventoryItemId &&
          old.description === lines[i].description &&
          old.quantity.equals(lines[i].quantity),
      );
    if (task.status === AreaTaskStatus.terminado) {
      // Tarea terminada: la hoja es historia (y su descuento ya corrió o está
      // pendiente). Reenviar la misma hoja es inofensivo; cambiarla no.
      if (unchanged) continue;
      throw new ConflictException(
        `La tarea de ${supply.area} ya está terminada; regrésala de "terminado" para cambiar sus insumos`,
      );
    }
    if (task.supply?.lines.some((l) => l.discountedAt !== null)) {
      throw new ConflictException(
        `Los insumos de ${supply.area} ya se descontaron del inventario; regresa la tarea de "terminado" para cambiarlos`,
      );
    }
    if (task.supply) {
      await tx.orderAreaSupplyLine.deleteMany({
        where: { supplyId: task.supply.id },
      });
      await tx.orderAreaSupply.update({
        where: { id: task.supply.id },
        data: { source: supply.source, lines: { create: lines } },
      });
    } else {
      await tx.orderAreaSupply.create({
        data: {
          areaTaskId: task.id,
          source: supply.source,
          createdById: userId,
          lines: { create: lines },
        },
      });
    }
  }

  // Avisos: lo apartado (incluida esta hoja) supera la existencia.
  const reserved = await reservedByItem(tx, itemIds);
  const warnings: string[] = [];
  for (const item of items) {
    const stock = Number(item.quantity);
    const held = reserved.get(item.id) ?? 0;
    if (held > stock) {
      warnings.push(
        `Stock insuficiente de ${item.name}: hay ${stock} ${item.unit} y quedan apartados ${held}`,
      );
    }
  }
  return warnings;
}

/** Semáforo mínimo de existencias (mismo criterio que el inventario). */
function stockLevel(quantity: number, minStock: number | null) {
  if (quantity <= 0) return 'out';
  if (minStock !== null && quantity <= minStock) return 'low';
  return 'ok';
}

/**
 * Descuenta (`finishing`) o devuelve (`!finishing`) las líneas "nuestras" de
 * una tarea. El llamador ya tiene el candado de la tarea.
 *
 * Cada línea se RECLAMA con `updateMany` (sólo si sigue sin descontar / ya
 * descontada): si otra transacción se adelantó, `count` es 0 y se omite, así
 * el stock se mueve exactamente una vez. Al descontar, una línea sin
 * existencia suficiente NO falla: se omite y se reporta como pendiente.
 */
async function moveSupplyLinesTx(
  tx: Tx,
  task: { id: number; orderId: number; area: string },
  finishing: boolean,
  userId: number,
): Promise<SupplyInventoryResult> {
  const result: SupplyInventoryResult = { pending: [], lowStock: [] };
  const lines = await tx.orderAreaSupplyLine.findMany({
    where: {
      supply: { areaTaskId: task.id, source: SupplySource.nosotros },
      inventoryItemId: { not: null },
      discountedAt: finishing ? null : { not: null },
    },
    select: { id: true, inventoryItemId: true, quantity: true },
    orderBy: { id: 'asc' },
  });
  // Siempre se bloquean los artículos en el mismo orden (por id) para que dos
  // tareas que comparten artículos no se interbloqueen.
  lines.sort(
    (a, b) =>
      (a.inventoryItemId as number) - (b.inventoryItemId as number) ||
      a.id - b.id,
  );

  for (const line of lines) {
    const itemId = line.inventoryItemId as number;
    const [locked] = await tx.$queryRaw<
      {
        quantity: Prisma.Decimal;
        name: string;
        unit: string;
        area: string;
        minStock: Prisma.Decimal | null;
      }[]
    >`SELECT "quantity", "name", "unit", "area", "minStock" FROM "InventoryItem" WHERE "id" = ${itemId} FOR UPDATE`;
    if (!locked) throw new NotFoundException('El artículo no existe');

    const current = new Prisma.Decimal(locked.quantity);
    const amount = new Prisma.Decimal(line.quantity);
    if (finishing && amount.greaterThan(current)) {
      result.pending.push({
        lineId: line.id,
        itemId,
        itemName: locked.name,
        unit: locked.unit,
        missing: amount.minus(current).toNumber(),
      });
      continue;
    }

    const claimed = await tx.orderAreaSupplyLine.updateMany({
      where: {
        id: line.id,
        discountedAt: finishing ? null : { not: null },
      },
      data: { discountedAt: finishing ? new Date() : null },
    });
    if (claimed.count === 0) continue;

    const delta = finishing ? amount.negated() : amount;
    const balance = current.plus(delta);
    await tx.inventoryItem.update({
      where: { id: itemId },
      data: { quantity: balance },
    });
    await tx.inventoryMovement.create({
      data: {
        itemId,
        type: finishing
          ? InventoryMovementType.SALIDA
          : InventoryMovementType.ENTRADA,
        delta,
        balanceBefore: current,
        balanceAfter: balance,
        note: finishing
          ? `Consumo pedido #${task.orderId} · ${task.area} terminado`
          : `Devolución pedido #${task.orderId} · ${task.area} regresó de terminado`,
        reason: `Pedido #${task.orderId} · tarea ${task.area}`,
        source: SUPPLY_MOVEMENT_SOURCE,
        area: locked.area,
        orderId: task.orderId,
        areaTaskId: task.id,
        createdById: userId,
      },
    });

    if (finishing) {
      const minStock =
        locked.minStock === null ? null : Number(locked.minStock);
      if (
        stockLevel(current.toNumber(), minStock) === 'ok' &&
        stockLevel(balance.toNumber(), minStock) !== 'ok'
      ) {
        result.lowStock.push({
          itemId,
          name: locked.name,
          unit: locked.unit,
          area: locked.area,
          minStock,
          after: balance.toNumber(),
        });
      }
    }
  }
  return result;
}

/**
 * Descuenta o devuelve los insumos "nuestros" de una tarea según su cambio de
 * estado. Idempotente: cada línea guarda `discountedAt` y se reclama de forma
 * atómica, así una línea nunca se descuenta (ni se devuelve) dos veces.
 * Terminar nunca falla por falta de stock (ver `moveSupplyLinesTx`).
 *
 * IMPORTANTE: el llamador debe tener el candado de la fila de la tarea
 * (`lockTaskStatusTx`) y haber validado la transición contra el estado real.
 */
export async function applySupplyInventoryForStatusTx(
  tx: Tx,
  task: { id: number; orderId: number; area: string },
  previous: AreaTaskStatus,
  next: AreaTaskStatus,
  userId: number,
): Promise<SupplyInventoryResult> {
  const finishing =
    next === AreaTaskStatus.terminado && previous !== AreaTaskStatus.terminado;
  const reopening =
    previous === AreaTaskStatus.terminado && next !== AreaTaskStatus.terminado;
  if (!finishing && !reopening) return { pending: [], lowStock: [] };
  return moveSupplyLinesTx(tx, task, finishing, userId);
}

/**
 * Reintenta el descuento de las líneas sin descontar de una tarea que YA está
 * `terminado` (porque faltaba stock al terminarla). Idempotente.
 */
export async function discountPendingSupplyTx(
  tx: Tx,
  task: { id: number; orderId: number; area: string },
  userId: number,
): Promise<SupplyInventoryResult> {
  const status = await lockTaskStatusTx(tx, task.id);
  if (status === null) throw new NotFoundException('La tarea no existe');
  if (status !== AreaTaskStatus.terminado) {
    throw new ConflictException(
      `La tarea de ${task.area} no está terminada: los insumos se descuentan al terminarla`,
    );
  }
  return moveSupplyLinesTx(tx, task, true, userId);
}
