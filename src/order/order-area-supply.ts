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
 *   no admite stock negativo: si no alcanza, no se puede terminar la tarea.
 * - Si la tarea regresa de `terminado`, se devuelven con una ENTRADA.
 * - Las líneas del cliente nunca tocan inventario.
 *
 * Todo opera sobre un cliente de transacción (`tx`) que pasa el llamador.
 */
type Tx = Prisma.TransactionClient;

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

  const tasks = await tx.orderAreaTask.findMany({
    where: { orderId, area: { in: supplies.map((s) => s.area) } },
    select: {
      id: true,
      area: true,
      status: true,
      supply: {
        select: {
          id: true,
          lines: {
            where: { discountedAt: { not: null } },
            select: { id: true },
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
    if (task.supply && task.supply.lines.length > 0) {
      throw new ConflictException(
        `Los insumos de ${supply.area} ya se descontaron del inventario; regresa la tarea de "terminado" para cambiarlos`,
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

/**
 * Descuenta o devuelve los insumos "nuestros" de una tarea según su cambio de
 * estado. Idempotente: cada línea guarda `discountedAt`, así una línea nunca
 * se descuenta (ni se devuelve) dos veces.
 */
export async function applySupplyInventoryForStatusTx(
  tx: Tx,
  task: { id: number; orderId: number; area: string },
  previous: AreaTaskStatus,
  next: AreaTaskStatus,
  userId: number,
) {
  const finishing =
    next === AreaTaskStatus.terminado && previous !== AreaTaskStatus.terminado;
  const reopening =
    previous === AreaTaskStatus.terminado && next !== AreaTaskStatus.terminado;
  if (!finishing && !reopening) return;

  const lines = await tx.orderAreaSupplyLine.findMany({
    where: {
      supply: { areaTaskId: task.id, source: SupplySource.nosotros },
      inventoryItemId: { not: null },
      discountedAt: finishing ? null : { not: null },
    },
    select: { id: true, inventoryItemId: true, quantity: true },
    orderBy: { id: 'asc' },
  });

  for (const line of lines) {
    const itemId = line.inventoryItemId as number;
    const [locked] = await tx.$queryRaw<
      { quantity: Prisma.Decimal; name: string; unit: string }[]
    >`SELECT "quantity", "name", "unit" FROM "InventoryItem" WHERE "id" = ${itemId} FOR UPDATE`;
    if (!locked) throw new NotFoundException('El artículo no existe');

    const current = new Prisma.Decimal(locked.quantity);
    const amount = new Prisma.Decimal(line.quantity);
    if (finishing && amount.greaterThan(current)) {
      throw new BadRequestException(
        `Stock insuficiente de ${locked.name}: hay ${current.toNumber()} ${locked.unit} y la hoja pide ${amount.toNumber()}. Registra la entrada en inventario antes de terminar.`,
      );
    }
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
        balanceAfter: balance,
        note: finishing
          ? `Consumo pedido #${task.orderId} · ${task.area} terminado`
          : `Devolución pedido #${task.orderId} · ${task.area} regresó de terminado`,
        orderId: task.orderId,
        areaTaskId: task.id,
        createdById: userId,
      },
    });
    await tx.orderAreaSupplyLine.update({
      where: { id: line.id },
      data: { discountedAt: finishing ? new Date() : null },
    });
  }
}
