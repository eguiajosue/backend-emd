import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { OrderController } from './order.controller';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AreaTaskStatus, Prisma } from '@prisma/client';
import {
  applySupplyInventoryForStatusTx,
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
              lines: state.lines.filter(
                (l) => l.supplyId === supply.id && l.discountedAt !== null,
              ),
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
      update: jest.fn(async ({ where, data }: any) => {
        state.lines.find((l) => l.id === where.id)!.discountedAt =
          data.discountedAt;
      }),
    },
    inventoryMovement: {
      create: jest.fn(async ({ data }: any) => {
        state.movements.push(data);
      }),
    },
    $queryRaw: jest.fn(async (_s: TemplateStringsArray, id: number) => {
      const item = state.items.get(id)!;
      return [{ ...item, quantity: new Prisma.Decimal(item.quantity) }];
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

  it('no deja el stock negativo: sin existencia no se puede terminar', async () => {
    const { state, tx } = makeDb();
    await saveSuppliesTx(
      tx,
      5,
      nuestros([{ inventoryItemId: 2, quantity: 3 }]),
      9,
    );

    await expect(
      applySupplyInventoryForStatusTx(tx, task, 'en_proceso', 'terminado', 33),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(state.items.get(2)!.quantity).toBe(1);
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
      const service = new OrderAreaTaskService(
        prisma as unknown as PrismaService,
        {
          userIdsForArea: jest.fn().mockResolvedValue([]),
          createNotificationForUsers: jest.fn(),
          createNotification: jest.fn(),
        } as unknown as NotificationService,
        { notifyNewOrderToArea: jest.fn() } as unknown as NotificationsGateway,
      );
      return { state, tx, prisma, service };
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

    it('si no alcanza el stock, la tarea no queda terminada', async () => {
      const { tx, prisma, service } = build();
      await saveSuppliesTx(
        tx,
        5,
        nuestros([{ inventoryItemId: 2, quantity: 3 }]),
        9,
      );

      await expect(
        service.updateStatus(
          70,
          AreaTaskStatus.terminado,
          { userId: 33, roles: ['bordado'] },
          5,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.orderAreaTask.update).not.toHaveBeenCalled();
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

  it('la consultan todos los que abren el pedido (Producción incluida)', () => {
    expect(rolesFor('getAreaSupplies')).toEqual(
      expect.arrayContaining([Role.RECEPCION, Role.BORDADO, Role.DTF]),
    );
  });
});
