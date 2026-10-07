import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { OrderController } from './order.controller';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AreaTaskStatus, Prisma } from '@prisma/client';
import {
  applySupplyInventoryForStatusTx,
  discountPendingSupplyTx,
  reservedByItem,
  saveSuppliesTx,
} from './order-area-supply';
import { OrderAreaTaskService } from './order-area-task.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from 'src/notification/notification.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';

type Line = {
  id: number;
  supplyId: number;
  inventoryItemId: number | null;
  description: string;
  quantity: Prisma.Decimal;
  discountedAt: Date | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */

/**
 * Base en memoria con lo justo para la hoja de materiales: una tarea de
 * bordado (id 70) del pedido 5 y dos artículos de inventario.
 */
function makeDb() {
  const state = {
    task: { id: 70, orderId: 5, area: 'bordado', status: 'pendiente' },
    supplies: [] as { id: number; areaTaskId: number; source: string }[],
    lines: [] as Line[],
    items: new Map([
      [1, { id: 1, name: 'Film DTF', unit: 'm', quantity: 10 }],
      [2, { id: 2, name: 'Tinta blanca', unit: 'litro', quantity: 1 }],
    ]),
    movements: [] as Record<string, unknown>[],
  };
  let nextLine = 1;
  const supplyOf = (supplyId: number) =>
    state.supplies.find((s) => s.id === supplyId)!;
  const matches = (line: Line, where: any) => {
    if (where.supply?.areaTaskId !== undefined)
      if (supplyOf(line.supplyId).areaTaskId !== where.supply.areaTaskId)
        return false;
    if (
      where.supply?.source &&
      supplyOf(line.supplyId).source !== where.supply.source
    )
      return false;
    if (
      where.inventoryItemId?.in &&
      !where.inventoryItemId.in.includes(line.inventoryItemId)
    )
      return false;
    if (where.inventoryItemId?.not === null && line.inventoryItemId === null)
      return false;
    if (where.discountedAt === null && line.discountedAt !== null) return false;
    if (where.discountedAt?.not === null && line.discountedAt === null)
      return false;
    return true;
  };
  const createLines = (supplyId: number, data: any[]) =>
    data.forEach((l) =>
      state.lines.push({ id: nextLine++, supplyId, discountedAt: null, ...l }),
    );

  const tx: any = {
    orderAreaTask: {
      findMany: jest.fn(async () => {
        const supply = state.supplies.find(
          (s) => s.areaTaskId === state.task.id,
        );
        return [
          {
            ...state.task,
            supply: supply && {
              id: supply.id,
              source: supply.source,
              lines: state.lines.filter((l) => l.supplyId === supply.id),
            },
          },
        ];
      }),
    },
    inventoryItem: {
      findMany: jest.fn(async ({ where }: any) =>
        where.id.in
          .map((id: number) => state.items.get(id))
          .filter(Boolean)
          .map((i: any) => ({
            ...i,
            quantity: new Prisma.Decimal(i.quantity),
          })),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        state.items.get(where.id)!.quantity = Number(data.quantity);
      }),
    },
    orderAreaSupply: {
      create: jest.fn(async ({ data }: any) => {
        const id = state.supplies.length + 1;
        state.supplies.push({
          id,
          areaTaskId: data.areaTaskId,
          source: data.source,
        });
        createLines(id, data.lines.create);
      }),
      update: jest.fn(async ({ where, data }: any) => {
        supplyOf(where.id).source = data.source;
        createLines(where.id, data.lines.create);
      }),
    },
    orderAreaSupplyLine: {
      findMany: jest.fn(async ({ where }: any) =>
        state.lines.filter((l) => matches(l, where)),
      ),
      deleteMany: jest.fn(async ({ where }: any) => {
        state.lines = state.lines.filter((l) => l.supplyId !== where.supplyId);
      }),
      // Reclamo atómico de la línea: sólo si cumple el `where` (aquí
      // `discountedAt: null` o `{ not: null }`).
      updateMany: jest.fn(async ({ where, data }: any) => {
        const line = state.lines.find(
          (l) =>
            l.id === where.id &&
            (where.discountedAt === null
              ? l.discountedAt === null
              : l.discountedAt !== null),
        );
        if (!line) return { count: 0 };
        line.discountedAt = data.discountedAt;
        return { count: 1 };
      }),
    },
    inventoryMovement: {
      create: jest.fn(async ({ data }: any) => {
        state.movements.push(data);
      }),
    },
    // Dos consultas crudas: candado de la tarea (devuelve su estado) y candado
    // del artículo (devuelve existencia y datos).
    $queryRaw: jest.fn(async (s: TemplateStringsArray, id: number) => {
      const sql = s.join('?');
      if (sql.includes('"OrderAreaTask"')) {
        return sql.includes('"status"') ? [{ status: state.task.status }] : [];
      }
      const item = state.items.get(id)!;
      return [
        {
          minStock: null,
          area: 'bordado',
          ...item,
          quantity: new Prisma.Decimal(item.quantity),
        },
      ];
    }),
  };
  return { state, tx };
}

const task = { id: 70, orderId: 5, area: 'bordado' };
const nuestros = (
  lines: { inventoryItemId?: number; description?: string; quantity: number }[],
) => [{ area: 'bordado' as const, source: 'nosotros' as const, lines }];

describe('Hoja de materiales por área (origen de insumos)', () => {
  it('al guardar, los insumos nuestros quedan apartados sin tocar el stock', async () => {
    const { state, tx } = makeDb();
    const warnings = await saveSuppliesTx(
      tx,
      5,
      nuestros([
        { inventoryItemId: 1, quantity: 2 },
        { description: 'Hilo especial', quantity: 1 },
      ]),
      9,
    );

    expect(warnings).toEqual([]);
    expect(state.items.get(1)!.quantity).toBe(10);
    expect(state.movements).toHaveLength(0);
    expect(state.lines[0].description).toBe('Film DTF');
    expect((await reservedByItem(tx, [1])).get(1)).toBe(2);
  });

  it('avisa (sin bloquear) si lo apartado supera la existencia', async () => {
    const { state, tx } = makeDb();
    const warnings = await saveSuppliesTx(
      tx,
      5,
      nuestros([{ inventoryItemId: 2, quantity: 3 }]),
      9,
    );
    expect(warnings[0]).toMatch(/Stock insuficiente de Tinta blanca/);
    expect(state.lines).toHaveLength(1);
  });

  it('descuenta con SALIDA al terminar, ligado a pedido + tarea + usuario', async () => {
    const { state, tx } = makeDb();
    await saveSuppliesTx(
      tx,
      5,
      nuestros([{ inventoryItemId: 1, quantity: 2 }]),
      9,
    );

    await applySupplyInventoryForStatusTx(
      tx,
      task,
      AreaTaskStatus.en_proceso,
      AreaTaskStatus.terminado,
      33,
    );

    expect(state.items.get(1)!.quantity).toBe(8);
    expect(state.movements).toEqual([
      expect.objectContaining({
        type: 'SALIDA',
        itemId: 1,
        orderId: 5,
        areaTaskId: 70,
        createdById: 33,
      }),
    ]);
    expect(state.lines[0].discountedAt).toBeInstanceOf(Date);
    expect((await reservedByItem(tx, [1])).get(1)).toBeUndefined();
  });

  it('es idempotente: terminar dos veces no descuenta dos veces', async () => {
    const { state, tx } = makeDb();
    await saveSuppliesTx(
      tx,
      5,
      nuestros([{ inventoryItemId: 1, quantity: 2 }]),
      9,
    );
    await applySupplyInventoryForStatusTx(
      tx,
      task,
      'en_proceso',
      'terminado',
      33,
    );
    await applySupplyInventoryForStatusTx(
      tx,
      task,
      'en_proceso',
      'terminado',
      33,
    );
    await applySupplyInventoryForStatusTx(
      tx,
      task,
      'terminado',
      'terminado',
      33,
    );

    expect(state.items.get(1)!.quantity).toBe(8);
    expect(state.movements).toHaveLength(1);
  });

  it('si la tarea regresa de terminado, devuelve con ENTRADA', async () => {
    const { state, tx } = makeDb();
    await saveSuppliesTx(
      tx,
      5,
      nuestros([{ inventoryItemId: 1, quantity: 2 }]),
      9,
    );
    await applySupplyInventoryForStatusTx(
      tx,
      task,
      'en_proceso',
      'terminado',
      33,
    );
    await applySupplyInventoryForStatusTx(
      tx,
      task,
      'terminado',
      'en_proceso',
      33,
    );

    expect(state.items.get(1)!.quantity).toBe(10);
    expect(state.movements.map((m) => m.type)).toEqual(['SALIDA', 'ENTRADA']);
    expect(state.lines[0].discountedAt).toBeNull();
  });

  it('sin existencia suficiente NO falla: la línea queda apartada (pendiente) y no toca el stock', async () => {
    const { state, tx } = makeDb();
    await saveSuppliesTx(
      tx,
      5,
      nuestros([{ inventoryItemId: 2, quantity: 3 }]),
      9,
    );

    const result = await applySupplyInventoryForStatusTx(
      tx,
      task,
      'en_proceso',
      'terminado',
      33,
    );

    expect(state.items.get(2)!.quantity).toBe(1);
    expect(state.movements).toHaveLength(0);
    expect(state.lines[0].discountedAt).toBeNull();
    expect(result.pending).toEqual([
      expect.objectContaining({
        itemName: 'Tinta blanca',
        unit: 'litro',
        missing: 2,
      }),
    ]);
  });

  it('con varias líneas descuenta las que alcanzan y deja pendientes las que no', async () => {
    const { state, tx } = makeDb();
    await saveSuppliesTx(
      tx,
      5,
      nuestros([
        { inventoryItemId: 1, quantity: 2 },
        { inventoryItemId: 2, quantity: 3 },
      ]),
      9,
    );
    const result = await applySupplyInventoryForStatusTx(
      tx,
      task,
      'en_proceso',
      'terminado',
      33,
    );
    expect(state.items.get(1)!.quantity).toBe(8);
    expect(state.items.get(2)!.quantity).toBe(1);
    expect(result.pending).toHaveLength(1);
    expect(state.lines.map((l) => l.discountedAt !== null)).toEqual([
      true,
      false,
    ]);
  });

  it('la bitácora queda completa: área, saldo anterior, motivo y origen "orden"', async () => {
    const { state, tx } = makeDb();
    await saveSuppliesTx(
      tx,
      5,
      nuestros([{ inventoryItemId: 1, quantity: 2 }]),
      9,
    );
    await applySupplyInventoryForStatusTx(
      tx,
      task,
      'en_proceso',
      'terminado',
      33,
    );
    expect(state.movements[0]).toEqual(
      expect.objectContaining({
        area: 'bordado',
        reason: 'Pedido #5 · tarea bordado',
        source: 'orden',
      }),
    );
    expect(Number(state.movements[0].balanceBefore)).toBe(10);
    expect(Number(state.movements[0].balanceAfter)).toBe(8);
  });

  it('avisa el cruce al punto de reorden', async () => {
    const { state, tx } = makeDb();
    (state.items.get(1) as any).minStock = new Prisma.Decimal(9);
    await saveSuppliesTx(
      tx,
      5,
      nuestros([{ inventoryItemId: 1, quantity: 2 }]),
      9,
    );
    const result = await applySupplyInventoryForStatusTx(
      tx,
      task,
      'en_proceso',
      'terminado',
      33,
    );
    expect(result.lowStock).toEqual([
      expect.objectContaining({ itemId: 1, after: 8, minStock: 9 }),
    ]);
  });

  it('el reclamo atómico evita el doble descuento aunque otra transacción ya reclamó la línea', async () => {
    const { state, tx } = makeDb();
    await saveSuppliesTx(
      tx,
      5,
      nuestros([{ inventoryItemId: 1, quantity: 2 }]),
      9,
    );
    // Simula que otra transacción reclama la línea entre el SELECT y el UPDATE.
    const realFind = tx.orderAreaSupplyLine.findMany;
    tx.orderAreaSupplyLine.findMany = jest.fn(async (args: any) => {
      const rows = await realFind(args);
      state.lines[0].discountedAt = new Date();
      return rows;
    });
    await applySupplyInventoryForStatusTx(
      tx,
      task,
      'en_proceso',
      'terminado',
      33,
    );
    expect(state.items.get(1)!.quantity).toBe(10);
    expect(state.movements).toHaveLength(0);
  });

  it('una devolución doble regresa el stock sólo una vez', async () => {
    const { state, tx } = makeDb();
    await saveSuppliesTx(
      tx,
      5,
      nuestros([{ inventoryItemId: 1, quantity: 2 }]),
      9,
    );
    await applySupplyInventoryForStatusTx(
      tx,
      task,
      'en_proceso',
      'terminado',
      33,
    );
    const realFind = tx.orderAreaSupplyLine.findMany;
    // Ambas reaperturas leen la línea como descontada; sólo una la reclama.
    tx.orderAreaSupplyLine.findMany = jest.fn(async (args: any) => {
      const rows = await realFind(args);
      return rows.length ? rows : [{ ...state.lines[0] }];
    });
    await applySupplyInventoryForStatusTx(
      tx,
      task,
      'terminado',
      'en_proceso',
      33,
    );
    await applySupplyInventoryForStatusTx(
      tx,
      task,
      'terminado',
      'en_proceso',
      33,
    );
    expect(state.items.get(1)!.quantity).toBe(10);
    expect(state.movements.map((m) => m.type)).toEqual(['SALIDA', 'ENTRADA']);
  });

  describe('discountPendingSupplyTx', () => {
    it('reintenta las líneas pendientes de una tarea terminada cuando ya hay stock', async () => {
      const { state, tx } = makeDb();
      await saveSuppliesTx(
        tx,
        5,
        nuestros([{ inventoryItemId: 2, quantity: 3 }]),
        9,
      );
      await applySupplyInventoryForStatusTx(
        tx,
        task,
        'en_proceso',
        'terminado',
        33,
      );
      state.task.status = 'terminado';

      // Aún no hay stock: sigue pendiente, sin error.
      const again = await discountPendingSupplyTx(tx, task, 1);
      expect(again.pending).toHaveLength(1);
      expect(state.movements).toHaveLength(0);

      // Entra inventario y se reintenta.
      state.items.get(2)!.quantity = 5;
      const ok = await discountPendingSupplyTx(tx, task, 1);
      expect(ok.pending).toEqual([]);
      expect(state.items.get(2)!.quantity).toBe(2);
      expect(state.movements).toHaveLength(1);

      // Idempotente: otro reintento no vuelve a descontar.
      await discountPendingSupplyTx(tx, task, 1);
      expect(state.items.get(2)!.quantity).toBe(2);
      expect(state.movements).toHaveLength(1);
    });

    it('409 si la tarea no está terminada', async () => {
      const { tx } = makeDb();
      await expect(discountPendingSupplyTx(tx, task, 1)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('PUT sobre una tarea terminada', () => {
    it('rechaza (409) agregar o reemplazar líneas', async () => {
      const { state, tx } = makeDb();
      await saveSuppliesTx(
        tx,
        5,
        nuestros([{ inventoryItemId: 2, quantity: 3 }]),
        9,
      );
      state.task.status = 'terminado';
      await expect(
        saveSuppliesTx(
          tx,
          5,
          nuestros([{ inventoryItemId: 1, quantity: 1 }]),
          9,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(state.lines).toHaveLength(1);
      expect(state.lines[0].inventoryItemId).toBe(2);
    });

    it('permite reenviar la misma hoja sin cambios', async () => {
      const { state, tx } = makeDb();
      await saveSuppliesTx(
        tx,
        5,
        nuestros([{ inventoryItemId: 2, quantity: 3 }]),
        9,
      );
      state.task.status = 'terminado';
      await expect(
        saveSuppliesTx(
          tx,
          5,
          nuestros([{ inventoryItemId: 2, quantity: 3 }]),
          9,
        ),
      ).resolves.toBeDefined();
      expect(state.lines).toHaveLength(1);
    });

    it('toma el candado de las tareas antes de leerlas', async () => {
      const { tx } = makeDb();
      await saveSuppliesTx(
        tx,
        5,
        nuestros([{ inventoryItemId: 1, quantity: 1 }]),
        9,
      );
      const sql = (tx.$queryRaw.mock.calls[0][0] as string[]).join('?');
      expect(sql).toContain('FOR UPDATE');
      expect(sql).toContain('"OrderAreaTask"');
    });
  });

  it('los insumos del cliente nunca tocan inventario', async () => {
    const { state, tx } = makeDb();
    await saveSuppliesTx(
      tx,
      5,
      [
        {
          area: 'bordado',
          source: 'cliente',
          lines: [{ description: '12 playeras negras', quantity: 12 }],
        },
      ],
      9,
    );
    await applySupplyInventoryForStatusTx(
      tx,
      task,
      'en_proceso',
      'terminado',
      33,
    );

    expect(state.movements).toHaveLength(0);
    expect([...state.items.values()].map((i) => i.quantity)).toEqual([10, 1]);
  });

  it('rechaza ligar al inventario un insumo del cliente', async () => {
    const { tx } = makeDb();
    await expect(
      saveSuppliesTx(
        tx,
        5,
        [
          {
            area: 'bordado',
            source: 'cliente',
            lines: [{ inventoryItemId: 1, quantity: 1 }],
          },
        ],
        9,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no permite cambiar la hoja si ya se descontó', async () => {
    const { tx } = makeDb();
    await saveSuppliesTx(
      tx,
      5,
      nuestros([{ inventoryItemId: 1, quantity: 2 }]),
      9,
    );
    await applySupplyInventoryForStatusTx(
      tx,
      task,
      'en_proceso',
      'terminado',
      33,
    );

    await expect(
      saveSuppliesTx(tx, 5, nuestros([{ inventoryItemId: 1, quantity: 5 }]), 9),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  describe('OrderAreaTaskService.updateStatus', () => {
    const build = () => {
      const { state, tx } = makeDb();
      state.task.status = 'en_proceso';
      const prisma = {
        ...tx,
        orderAreaTask: {
          ...tx.orderAreaTask,
          findUnique: jest.fn().mockResolvedValue({
            ...task,
            status: 'en_proceso',
            assignedUserId: 33,
          }),
          findMany: jest
            .fn()
            .mockResolvedValue([
              { status: 'en_proceso' },
              { status: 'pendiente' },
            ]),
          update: jest.fn().mockResolvedValue({ id: 70 }),
        },
        order: {
          findUnique: jest.fn().mockResolvedValue({ statusId: 9, userId: 1 }),
        },
        status: { findUnique: jest.fn().mockResolvedValue({ id: 4 }) },
        user: { findFirst: jest.fn().mockResolvedValue(null) },
        $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(prisma)),
      };
      const notifications = {
        userIdsForArea: jest.fn().mockResolvedValue([7]),
        createNotificationForUsers: jest.fn(),
        createNotification: jest.fn(),
      };
      const service = new OrderAreaTaskService(
        prisma as unknown as PrismaService,
        notifications as unknown as NotificationService,
        { notifyNewOrderToArea: jest.fn() } as unknown as NotificationsGateway,
      );
      return { state, tx, prisma, service, notifications };
    };

    it('descuenta dentro de la transacción del cambio de estado', async () => {
      const { state, tx, prisma, service } = build();
      await saveSuppliesTx(
        tx,
        5,
        nuestros([{ inventoryItemId: 1, quantity: 2 }]),
        9,
      );

      await service.updateStatus(
        70,
        AreaTaskStatus.terminado,
        { userId: 33, roles: ['bordado'] },
        5,
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(state.items.get(1)!.quantity).toBe(8);
      expect(prisma.orderAreaTask.update).toHaveBeenCalled();
    });

    it('si no alcanza el stock, la tarea SÍ queda terminada y se avisa a Recepción/admin', async () => {
      const { tx, prisma, service, notifications } = build();
      await saveSuppliesTx(
        tx,
        5,
        nuestros([{ inventoryItemId: 2, quantity: 3 }]),
        9,
      );

      await service.updateStatus(
        70,
        AreaTaskStatus.terminado,
        { userId: 33, roles: ['bordado'] },
        5,
      );

      expect(prisma.orderAreaTask.update).toHaveBeenCalled();
      expect(notifications.userIdsForArea).toHaveBeenCalledWith('recepcion');
      expect(notifications.userIdsForArea).toHaveBeenCalledWith('admin');
      expect(notifications.createNotificationForUsers).toHaveBeenCalledWith(
        [7],
        expect.objectContaining({
          type: 'inventory_pending_discount',
          orderId: 5,
          body: 'No se descontó Tinta blanca del pedido #5: faltan 2 litro',
        }),
      );
    });

    it('si otra petición ya terminó la tarea mientras esperaba el candado, no repite nada', async () => {
      const { state, tx, prisma, service, notifications } = build();
      await saveSuppliesTx(
        tx,
        5,
        nuestros([{ inventoryItemId: 1, quantity: 2 }]),
        9,
      );
      // Al tomar el candado, la tarea ya está terminada (la otra petición ganó).
      state.task.status = 'terminado';
      prisma.orderAreaTask.findUniqueOrThrow = jest
        .fn()
        .mockResolvedValue({ id: 70, status: 'terminado' });

      await service.updateStatus(
        70,
        AreaTaskStatus.terminado,
        { userId: 33, roles: ['bordado'] },
        5,
      );

      expect(state.items.get(1)!.quantity).toBe(10);
      expect(state.movements).toHaveLength(0);
      expect(prisma.orderAreaTask.update).not.toHaveBeenCalled();
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('revalida la transición con el estado bloqueado (no el leído antes)', async () => {
      const { state, tx, prisma, service } = build();
      await saveSuppliesTx(
        tx,
        5,
        nuestros([{ inventoryItemId: 1, quantity: 2 }]),
        9,
      );
      // Otra petición la regresó a pendiente: terminar ya no es válido.
      state.task.status = 'pendiente';
      await expect(
        service.updateStatus(
          70,
          AreaTaskStatus.terminado,
          { userId: 33, roles: ['bordado'] },
          5,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(state.items.get(1)!.quantity).toBe(10);
      expect(prisma.orderAreaTask.update).not.toHaveBeenCalled();
    });

    it('discountPending: sólo sobre una tarea del pedido y devuelve la hoja', async () => {
      const { state, tx, prisma, service } = build();
      await saveSuppliesTx(
        tx,
        5,
        nuestros([{ inventoryItemId: 1, quantity: 2 }]),
        9,
      );
      state.task.status = 'terminado';
      prisma.orderAreaTask.findFirst = jest
        .fn()
        .mockResolvedValue({ id: 70, orderId: 5, area: 'bordado' });
      prisma.inventoryItem.findMany = jest.fn().mockResolvedValue([]);
      prisma.inventoryMovement.findMany = jest.fn().mockResolvedValue([]);
      prisma.orderAreaTask.findMany = jest.fn().mockResolvedValue([]);

      await service.discountPending(5, 'bordado', {
        userId: 1,
        roles: ['recepcion'],
      });
      expect(state.items.get(1)!.quantity).toBe(8);

      prisma.orderAreaTask.findFirst.mockResolvedValue(null);
      await expect(
        service.discountPending(5, 'dtf', { userId: 1, roles: ['recepcion'] }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('otra área no puede terminar la tarea (ni descontar)', async () => {
      const { state, tx, service } = build();
      await saveSuppliesTx(
        tx,
        5,
        nuestros([{ inventoryItemId: 1, quantity: 2 }]),
        9,
      );

      await expect(
        service.updateStatus(
          70,
          AreaTaskStatus.terminado,
          { userId: 40, roles: ['dtf'] },
          5,
        ),
      ).rejects.toBeDefined();
      expect(state.items.get(1)!.quantity).toBe(10);
    });
  });
});

describe('OrderController: roles de la hoja de materiales por área', () => {
  const reflector = new Reflector();
  const rolesFor = (methodName: keyof OrderController): string[] =>
    [
      ...(reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
        OrderController.prototype[methodName] as () => unknown,
        OrderController,
      ]) ?? []),
    ].sort();

  it('sólo Recepción/admin/superuser corrigen la hoja', () => {
    expect(rolesFor('saveAreaSupplies')).toEqual(
      [Role.RECEPCION, Role.ADMIN, Role.SUPERUSER].sort(),
    );
  });

  it('sólo Recepción/admin/superuser reintentan el descuento pendiente', () => {
    expect(rolesFor('discountPendingAreaSupplies')).toEqual(
      [Role.RECEPCION, Role.ADMIN, Role.SUPERUSER].sort(),
    );
  });

  it('la consultan todos los que abren el pedido (Producción incluida)', () => {
    expect(rolesFor('getAreaSupplies')).toEqual(
      expect.arrayContaining([Role.RECEPCION, Role.BORDADO, Role.DTF]),
    );
  });
});
