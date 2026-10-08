import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OrderAreaTaskService } from './order-area-task.service';
import { OrderService } from './order.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from 'src/notification/notification.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { AreaSupplyLineDto } from './dto/order-area-supply.dto';
import { CreateInventoryMovementDto } from '../inventory/dto/create-inventory-movement.dto';
import { CreateRestockRequestDto } from '../inventory/dto/restock-request.dto';
import { AuditLogService } from 'src/audit-log/audit-log.service';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */

const supplyOf = (taskId: number, discounted: boolean) => ({
  id: taskId * 10,
  source: 'nosotros',
  updatedAt: new Date(),
  lines: [
    {
      id: taskId * 100,
      inventoryItemId: 1,
      description: 'Film DTF',
      quantity: new Prisma.Decimal(4),
      discountedAt: discounted ? new Date() : null,
      inventoryItem: {
        id: 1,
        name: 'Film DTF',
        unit: 'm',
        area: 'dtf',
        barcode: 'EMD-000001',
      },
    },
  ],
});

describe('Hoja de materiales: visibilidad y descuento pendiente', () => {
  let prisma: any;
  let service: OrderAreaTaskService;

  beforeEach(() => {
    prisma = {
      orderAreaTask: {
        findMany: jest.fn(async ({ where }: any) => {
          const all = [
            {
              id: 1,
              area: 'bordado',
              status: 'terminado',
              supply: supplyOf(1, false),
            },
            {
              id: 2,
              area: 'dtf',
              status: 'en_proceso',
              supply: supplyOf(2, false),
            },
          ];
          const only = where.area?.in as string[] | undefined;
          return all.filter((t) => !only || only.includes(t.area));
        }),
      },
      inventoryItem: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 1, quantity: new Prisma.Decimal(1) }]),
      },
      orderAreaSupplyLine: { findMany: jest.fn().mockResolvedValue([]) },
      inventoryMovement: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new OrderAreaTaskService(
      prisma as PrismaService,
      {} as NotificationService,
      {} as NotificationsGateway,
      {
        record: jest.fn().mockResolvedValue(undefined),
      } as unknown as AuditLogService,
    );
  });

  it('sucursal: 403 al consultar los insumos', async () => {
    await expect(
      service.getSupplySheet(5, { userId: 7, roles: ['sucursal'] }),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.orderAreaTask.findMany).not.toHaveBeenCalled();
  });

  it('un área sólo recibe las hojas (y movimientos) de SUS áreas', async () => {
    const sheet = await service.getSupplySheet(5, {
      userId: 20,
      roles: ['dtf'],
    });
    expect(sheet.areas.map((a) => a.area)).toEqual(['dtf']);
    expect(prisma.orderAreaTask.findMany.mock.calls[0][0].where).toEqual({
      orderId: 5,
      area: { in: ['dtf'] },
    });
    expect(
      prisma.inventoryMovement.findMany.mock.calls[0][0].where.areaTaskId,
    ).toEqual({ in: [2] });
  });

  it('Recepción/admin ven todas las áreas', async () => {
    const sheet = await service.getSupplySheet(5, {
      userId: 1,
      roles: ['recepcion'],
    });
    expect(sheet.areas.map((a) => a.area)).toEqual(['bordado', 'dtf']);
  });

  it('marca pendingDiscount + faltante en una tarea terminada con líneas sin descontar', async () => {
    const sheet = await service.getSupplySheet(5, {
      userId: 1,
      roles: ['admin'],
    });
    const [bordado, dtf] = sheet.areas;
    expect(bordado.pendingDiscount).toBe(true);
    expect(bordado.supply!.lines[0]).toMatchObject({
      pendingDiscount: true,
      shortfall: 3,
      state: 'apartado',
    });
    // La que sigue en proceso sólo está apartada.
    expect(dtf.pendingDiscount).toBe(false);
    expect(dtf.supply!.lines[0]).toMatchObject({
      pendingDiscount: false,
      shortfall: 0,
    });
  });

  it('una línea ya descontada no está pendiente', async () => {
    prisma.orderAreaTask.findMany.mockResolvedValue([
      {
        id: 1,
        area: 'bordado',
        status: 'terminado',
        supply: supplyOf(1, true),
      },
    ]);
    const sheet = await service.getSupplySheet(5, {
      userId: 1,
      roles: ['admin'],
    });
    expect(sheet.areas[0].pendingDiscount).toBe(false);
    expect(sheet.areas[0].supply!.lines[0]).toMatchObject({
      state: 'descontado',
      pendingDiscount: false,
    });
  });

  describe('la sucursal no recibe `supply` en las tareas de área', () => {
    const task = {
      id: 1,
      orderId: 5,
      area: 'dtf',
      status: 'pendiente',
      supply: supplyOf(1, false),
    };
    it('GET /orders/:id/area-tasks', async () => {
      prisma.orderAreaTask.findMany.mockResolvedValue([task]);
      const branch = await service.findByOrder(5, {
        userId: 7,
        roles: ['sucursal'],
      });
      expect(branch[0]).not.toHaveProperty('supply');
      const manager = await service.findByOrder(5, {
        userId: 1,
        roles: ['recepcion'],
      });
      expect(manager[0]).toHaveProperty('supply');
    });

    it('GET /orders (select del listado)', () => {
      const orderService = new OrderService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
      const branchSelect = (orderService as any).orderListSelect({
        userId: 7,
        roles: ['sucursal'],
      });
      expect(branchSelect.areaTasks.select).not.toHaveProperty('supply');
      expect(branchSelect.areaTasks.select).toHaveProperty('status');
      const managerSelect = (orderService as any).orderListSelect({
        userId: 1,
        roles: ['recepcion'],
      });
      expect(managerSelect.areaTasks.select).toHaveProperty('supply');
    });
  });
});

describe('Topes de cantidad (Decimal(12,3))', () => {
  const errorsOf = (cls: any, plain: object) =>
    validate(plainToInstance(cls, plain)).then((e) => e.map((x) => x.property));

  it('línea de insumo', async () => {
    expect(await errorsOf(AreaSupplyLineDto, { quantity: 1000000 })).toContain(
      'quantity',
    );
    expect(await errorsOf(AreaSupplyLineDto, { quantity: 999999 })).toEqual([]);
  });

  it('movimiento de inventario', async () => {
    expect(
      await errorsOf(CreateInventoryMovementDto, {
        type: 'ENTRADA',
        quantity: 1e9,
      }),
    ).toContain('quantity');
    expect(
      await errorsOf(CreateInventoryMovementDto, {
        type: 'ENTRADA',
        quantity: 999999,
      }),
    ).toEqual([]);
  });

  it('solicitud de reabasto', async () => {
    const base = { area: 'bordado', itemName: 'Hilo', unit: 'cono' };
    expect(
      await errorsOf(CreateRestockRequestDto, { ...base, quantity: 1e9 }),
    ).toContain('quantity');
    expect(
      await errorsOf(CreateRestockRequestDto, { ...base, quantity: 12 }),
    ).not.toContain('quantity');
  });
});
