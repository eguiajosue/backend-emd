import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InventoryService, stockStatusOf } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

const admin = { sub: 1, roles: ['admin'] };
const bordado = { sub: 2, roles: ['bordado'] };
const recepcion = { sub: 2, roles: ['recepcion'] };

const itemRow = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  area: 'bordado',
  name: 'Hilo poliéster rojo',
  sku: null,
  category: 'Hilos',
  unit: 'cono',
  color: 'Rojo',
  brand: 'Madeira',
  location: null,
  quantity: new Prisma.Decimal(10),
  minStock: new Prisma.Decimal(3),
  unitCost: new Prisma.Decimal(45.5),
  notes: null,
  materialId: null,
  supplierId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  material: null,
  supplier: null,
  ...overrides,
});

describe('stockStatusOf', () => {
  it('distingue agotado, bajo stock y disponible', () => {
    expect(stockStatusOf(0, 3)).toBe('out');
    expect(stockStatusOf(3, 3)).toBe('low');
    expect(stockStatusOf(4, 3)).toBe('ok');
    expect(stockStatusOf(1, null)).toBe('ok');
  });
});

describe('InventoryService', () => {
  let service: InventoryService;
  let prisma: {
    inventoryItem: Record<string, jest.Mock>;
    inventoryMovement: Record<string, jest.Mock>;
    order: { findUnique: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let notifications: {
    userIdsForArea: jest.Mock;
    createNotificationForUsers: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      inventoryItem: {
        findMany: jest.fn().mockResolvedValue([itemRow()]),
        findUnique: jest.fn().mockResolvedValue(itemRow()),
        findUniqueOrThrow: jest.fn().mockResolvedValue(itemRow()),
        create: jest.fn().mockResolvedValue({ id: 7 }),
        update: jest.fn().mockResolvedValue(itemRow()),
        delete: jest.fn(),
      },
      inventoryMovement: {
        create: jest.fn((args: { data: Record<string, unknown> }) => ({
          id: 1,
          ...args.data,
          unitCost: args.data.unitCost ?? null,
        })),
        findMany: jest.fn().mockResolvedValue([]),
      },
      order: { findUnique: jest.fn().mockResolvedValue({ id: 99 }) },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ quantity: new Prisma.Decimal(10) }]),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
    notifications = {
      userIdsForArea: jest.fn().mockResolvedValue([2, 3]),
      createNotificationForUsers: jest.fn().mockResolvedValue(undefined),
    };
    service = new InventoryService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationService,
    );
  });

  describe('alcance por departamento', () => {
    it('admin/recepción ven todos los departamentos', () => {
      expect(service.areasFor(['recepcion'])).toContain('impresiones');
      expect(service.areasFor(['admin'])).toHaveLength(7);
    });

    it('un rol de área sólo ve el suyo', () => {
      expect(service.areasFor(['bordado', 'dtf'])).toEqual(['dtf', 'bordado']);
    });

    it('el listado se recorta a las áreas del usuario', async () => {
      await service.findAll(bordado);
      expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { area: { in: ['bordado'] } } }),
      );
    });

    it('rechaza pedir el inventario de otro departamento', async () => {
      await expect(service.findAll(bordado, 'impresiones')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('un rol de área sólo consulta: no crea, edita, borra ni mueve stock (ni en su área)', async () => {
      await expect(
        service.create(
          { area: 'bordado', name: 'Hilo', unit: 'cono' },
          bordado,
        ),
      ).rejects.toThrow('Sólo administración o Recepción');
      await expect(service.update(7, { name: 'X' }, bordado)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.remove(7, bordado)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        service.registerMovement(7, { type: 'SALIDA', quantity: 1 }, bordado),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
      expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
      expect(prisma.inventoryItem.delete).not.toHaveBeenCalled();
      expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('un rol de área sí consulta el kardex de su departamento', async () => {
      await expect(
        service.findMovements(bordado, { itemId: 7 }),
      ).resolves.toEqual([]);
    });

    it('admin y recepción crean, editan y borran en cualquier departamento', async () => {
      await service.create(
        { area: 'impresiones', name: 'Tinta', unit: 'litro' },
        recepcion,
      );
      await service.update(7, { name: 'Y' }, recepcion);
      await expect(service.remove(7, recepcion)).resolves.toEqual({
        success: true,
      });
      await expect(service.remove(7, admin)).resolves.toEqual({
        success: true,
      });
    });
  });

  it('serializa decimales y calcula estado y valor', async () => {
    const [item] = await service.findAll(admin);
    expect(item).toMatchObject({
      quantity: 10,
      minStock: 3,
      unitCost: 45.5,
      stockStatus: 'ok',
      totalValue: 455,
    });
  });

  it('el alta con stock inicial deja una ENTRADA en el kardex', async () => {
    await service.create(
      { area: 'bordado', name: 'Hilo', unit: 'cono', initialQuantity: 12 },
      recepcion,
    );
    expect(prisma.inventoryItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quantity: 12, area: 'bordado' }),
      }),
    );
    expect(prisma.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'ENTRADA',
        delta: 12,
        balanceAfter: 12,
        note: 'Stock inicial',
        createdById: 2,
      }),
    });
  });

  it('el alta sin stock inicial no crea movimiento', async () => {
    await service.create(
      { area: 'bordado', name: 'Hilo', unit: 'cono' },
      admin,
    );
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('un SKU repetido en el departamento devuelve 409 legible', async () => {
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(
      service.create(
        { area: 'bordado', name: 'Hilo', unit: 'cono', sku: 'A1' },
        admin,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('al editar, "" borra un texto opcional y undefined no lo toca', async () => {
    await service.update(7, { location: '', name: 'Nuevo' }, admin);
    const { data } = prisma.inventoryItem.update.mock.calls[0][0];
    expect(data.location).toBeNull();
    expect(data.name).toBe('Nuevo');
    expect(data.brand).toBeUndefined();
  });

  describe('movimientos', () => {
    it('ENTRADA suma y actualiza el costo de referencia', async () => {
      await service.registerMovement(
        7,
        { type: 'ENTRADA', quantity: 5, unitCost: 50 },
        recepcion,
      );
      const { data } = prisma.inventoryItem.update.mock.calls[0][0];
      expect(Number(data.quantity)).toBe(15);
      expect(data.unitCost).toBe(50);
      const movement = prisma.inventoryMovement.create.mock.calls[0][0].data;
      expect(Number(movement.delta)).toBe(5);
      expect(Number(movement.balanceAfter)).toBe(15);
    });

    it('SALIDA resta y puede imputarse a un pedido', async () => {
      await service.registerMovement(
        7,
        { type: 'SALIDA', quantity: 2.5, orderId: 99 },
        recepcion,
      );
      const movement = prisma.inventoryMovement.create.mock.calls[0][0].data;
      expect(Number(movement.delta)).toBe(-2.5);
      expect(Number(movement.balanceAfter)).toBe(7.5);
      expect(movement.orderId).toBe(99);
    });

    it('SALIDA mayor al stock se rechaza', async () => {
      await expect(
        service.registerMovement(
          7,
          { type: 'SALIDA', quantity: 11 },
          recepcion,
        ),
      ).rejects.toThrow('Stock insuficiente');
      expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    });

    it('cantidad 0 sólo vale para un AJUSTE', async () => {
      await expect(
        service.registerMovement(
          7,
          { type: 'ENTRADA', quantity: 0 },
          recepcion,
        ),
      ).rejects.toThrow(BadRequestException);
      await service.registerMovement(
        7,
        { type: 'AJUSTE', quantity: 0 },
        recepcion,
      );
      const movement = prisma.inventoryMovement.create.mock.calls[0][0].data;
      expect(Number(movement.delta)).toBe(-10);
      expect(Number(movement.balanceAfter)).toBe(0);
    });

    it('AJUSTE fija el stock al conteo físico', async () => {
      await service.registerMovement(
        7,
        { type: 'AJUSTE', quantity: 8 },
        recepcion,
      );
      const movement = prisma.inventoryMovement.create.mock.calls[0][0].data;
      expect(Number(movement.delta)).toBe(-2);
      expect(Number(movement.balanceAfter)).toBe(8);
    });

    it('un pedido inexistente se rechaza', async () => {
      prisma.order.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.registerMovement(
          7,
          { type: 'SALIDA', quantity: 1, orderId: 5 },
          recepcion,
        ),
      ).rejects.toThrow('El pedido no existe');
    });

    it('avisa al cruzar el punto de reorden (sin incluir a quien movió)', async () => {
      await service.registerMovement(
        7,
        { type: 'SALIDA', quantity: 8 },
        recepcion,
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(notifications.userIdsForArea).toHaveBeenCalledWith('bordado');
      expect(notifications.createNotificationForUsers).toHaveBeenCalledWith(
        [3],
        expect.objectContaining({
          type: 'inventory_low_stock',
          title: 'Stock bajo: Hilo poliéster rojo (Bordado)',
        }),
      );
    });

    it('no repite el aviso si ya estaba bajo stock', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { quantity: new Prisma.Decimal(2) },
      ]);
      await service.registerMovement(
        7,
        { type: 'SALIDA', quantity: 1 },
        recepcion,
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(notifications.createNotificationForUsers).not.toHaveBeenCalled();
    });
  });
});
