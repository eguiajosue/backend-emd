import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  InventoryService,
  normalizeBarcode,
  stockStatusOf,
} from './inventory.service';
import { defaultBarcode } from './inventory.constants';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
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
  barcode: 'EMD-000007',
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
  createdAt: new Date('2026-10-01T12:00:00Z'),
  updatedAt: new Date('2026-10-01T12:00:00Z'),
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

describe('códigos de barras: formato', () => {
  it('el código por omisión es EMD- + id con 6 ceros (sin recortar ids largos)', () => {
    expect(defaultBarcode(7)).toBe('EMD-000007');
    expect(defaultBarcode(123)).toBe('EMD-000123');
    expect(defaultBarcode(999999)).toBe('EMD-999999');
    expect(defaultBarcode(1234567)).toBe('EMD-1234567');
  });

  it('la migración asigna el mismo formato a los artículos existentes', () => {
    const dir = join(__dirname, '../../prisma/migrations');
    const folder = readdirSync(dir).find((name) =>
      name.endsWith('_inventory_barcode'),
    );
    expect(folder).toBeDefined();
    const sql = readFileSync(join(dir, folder!, 'migration.sql'), 'utf8');
    expect(sql).toContain('ADD COLUMN     "barcode" TEXT');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "InventoryItem_barcode_key" ON "InventoryItem"("barcode")',
    );
    expect(sql).toMatch(/UPDATE "InventoryItem"\s+SET "barcode" = 'EMD-' \|\|/);
    expect(sql).toContain('lpad("id"::text, 6, \'0\')');
    expect(sql).toContain('WHERE "barcode" IS NULL');
  });

  it('normaliza recortando y acepta EAN/UPC y ASCII imprimible', () => {
    expect(normalizeBarcode('  7501234567890 ')).toBe('7501234567890');
    expect(normalizeBarcode('AB-12/x %$')).toBe('AB-12/x %$');
  });

  it('rechaza largo fuera de 3..64 y caracteres fuera de Code 128 (400)', () => {
    expect(() => normalizeBarcode('ab')).toThrow(BadRequestException);
    expect(() => normalizeBarcode('x'.repeat(65))).toThrow(BadRequestException);
    expect(() => normalizeBarcode('CAÑA-01')).toThrow('sólo admite');
    expect(() => normalizeBarcode('AB\tC')).toThrow(BadRequestException);
  });

  it('los EMD-<número> están reservados salvo el propio del artículo', () => {
    expect(() => normalizeBarcode('EMD-000123')).toThrow(
      'los asigna el sistema',
    );
    expect(() => normalizeBarcode('EMD-000123', 5)).toThrow(
      BadRequestException,
    );
    expect(normalizeBarcode('EMD-000123', 123)).toBe('EMD-000123');
    expect(normalizeBarcode('EMD-ROJO')).toBe('EMD-ROJO');
  });
});

describe('códigos de barras: DTO', () => {
  const errorsOf = async (cls: any, body: Record<string, unknown>) => {
    const dto = plainToInstance(cls, body) as object;
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return { dto: dto as { barcode?: unknown }, errors };
  };
  const base = { area: 'bordado', name: 'Hilo', unit: 'cono' };

  it('recorta y acepta un código válido en alta y edición', async () => {
    const created = await errorsOf(CreateInventoryItemDto, {
      ...base,
      barcode: '  7501234567890  ',
    });
    expect(created.errors).toHaveLength(0);
    expect(created.dto.barcode).toBe('7501234567890');
    const updated = await errorsOf(UpdateInventoryItemDto, {
      barcode: 'ABC-1',
    });
    expect(updated.errors).toHaveLength(0);
  });

  it('null y "" limpian (vuelven al código por omisión)', async () => {
    for (const barcode of [null, '', '   ']) {
      const { dto, errors } = await errorsOf(UpdateInventoryItemDto, {
        barcode,
      });
      expect(errors).toHaveLength(0);
      expect(dto.barcode).toBeNull();
    }
  });

  it('rechaza caracteres no ASCII y largos fuera de rango', async () => {
    for (const barcode of ['CAÑA', 'ab', 'x'.repeat(65), 'A\u0007B', 42]) {
      const { errors } = await errorsOf(CreateInventoryItemDto, {
        ...base,
        barcode,
      });
      expect(errors.map((e) => e.property)).toContain('barcode');
    }
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
      // Sólo Recepción y admin manejan el inventario: el área no recibe el aviso.
      expect(notifications.userIdsForArea).not.toHaveBeenCalledWith('bordado');
      expect(notifications.userIdsForArea).toHaveBeenCalledWith('recepcion');
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

  describe('códigos de barras', () => {
    /** Artículos por código para findUnique({ where: { barcode } }). */
    let byBarcode: Record<string, ReturnType<typeof itemRow>>;

    beforeEach(() => {
      byBarcode = {
        'EMD-000007': itemRow(),
        '7501234567890': itemRow({
          id: 9,
          name: 'Tinta cyan',
          area: 'impresiones',
          barcode: '7501234567890',
        }),
      };
      prisma.inventoryItem.findUnique.mockImplementation(
        ({ where }: { where: { id?: number; barcode?: string } }) =>
          where.barcode !== undefined
            ? (byBarcode[where.barcode] ?? null)
            : itemRow(),
      );
    });

    it('el alta sin código asigna EMD- + id en la misma transacción', async () => {
      prisma.inventoryItem.create.mockResolvedValueOnce({ id: 123 });
      await service.create(
        { area: 'bordado', name: 'Hilo', unit: 'cono' },
        admin,
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(
        prisma.inventoryItem.create.mock.calls[0][0].data.barcode,
      ).toBeNull();
      expect(prisma.inventoryItem.update).toHaveBeenCalledWith({
        where: { id: 123 },
        data: { barcode: 'EMD-000123' },
        select: { id: true },
      });
    });

    it('el alta con código propio lo guarda recortado y no genera otro', async () => {
      await service.create(
        { area: 'bordado', name: 'Hilo', unit: 'cono', barcode: ' ABC-77 ' },
        admin,
      );
      expect(prisma.inventoryItem.create.mock.calls[0][0].data.barcode).toBe(
        'ABC-77',
      );
      expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    });

    it('el alta con null usa el código por omisión', async () => {
      await service.create(
        { area: 'bordado', name: 'Hilo', unit: 'cono', barcode: null },
        admin,
      );
      expect(prisma.inventoryItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { barcode: 'EMD-000007' } }),
      );
    });

    it('un código ya asignado devuelve 409 con el nombre del artículo', async () => {
      await expect(
        service.create(
          {
            area: 'bordado',
            name: 'Hilo',
            unit: 'cono',
            barcode: '7501234567890',
          },
          admin,
        ),
      ).rejects.toThrow(
        new ConflictException('Ese código ya está asignado a Tinta cyan'),
      );
      await expect(
        service.update(7, { barcode: '7501234567890' }, admin),
      ).rejects.toThrow('Ese código ya está asignado a Tinta cyan');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    });

    it('una carrera en el índice único del código también da 409', async () => {
      prisma.inventoryItem.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
          meta: { target: ['barcode'] },
        }),
      );
      await expect(
        service.update(7, { barcode: 'NUEVO-1' }, admin),
      ).rejects.toThrow('Ese código ya está asignado a otro artículo');
    });

    it('caracteres inválidos o EMD- ajeno dan 400 sin escribir', async () => {
      await expect(
        service.create(
          { area: 'bordado', name: 'Hilo', unit: 'cono', barcode: 'ÑANDÚ-1' },
          admin,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.update(7, { barcode: 'EMD-000009' }, admin),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
      expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    });

    it('al editar: cambia, conserva el propio y null vuelve al EMD- por omisión', async () => {
      await service.update(7, { barcode: 'NUEVO-1' }, admin);
      expect(prisma.inventoryItem.update.mock.calls[0][0].data.barcode).toBe(
        'NUEVO-1',
      );
      await service.update(7, { barcode: 'EMD-000007' }, admin);
      expect(prisma.inventoryItem.update.mock.calls[1][0].data.barcode).toBe(
        'EMD-000007',
      );
      await service.update(7, { barcode: null }, admin);
      expect(prisma.inventoryItem.update.mock.calls[2][0].data.barcode).toBe(
        'EMD-000007',
      );
      await service.update(7, { name: 'Otro' }, admin);
      expect(
        prisma.inventoryItem.update.mock.calls[3][0].data,
      ).not.toHaveProperty('barcode');
    });

    it('el artículo serializado incluye su código', async () => {
      await expect(service.findOne(7, admin)).resolves.toMatchObject({
        id: 7,
        barcode: 'EMD-000007',
        area: 'bordado',
        quantity: 10,
        stockStatus: 'ok',
      });
    });

    describe('búsqueda por código', () => {
      it('encuentra el artículo con el mismo formato que el detalle', async () => {
        const found = await service.findByBarcode(' EMD-000007 ', admin);
        expect(prisma.inventoryItem.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({ where: { barcode: 'EMD-000007' } }),
        );
        expect(found).toEqual(await service.findOne(7, admin));
      });

      it('un código desconocido da 404 legible', async () => {
        await expect(service.findByBarcode('NO-EXISTE', admin)).rejects.toThrow(
          new NotFoundException(
            'No hay ningún artículo con el código NO-EXISTE',
          ),
        );
      });

      it('un artículo de otro departamento da el mismo 404 (no se revela)', async () => {
        await expect(
          service.findByBarcode('7501234567890', bordado),
        ).rejects.toThrow(NotFoundException);
        await expect(
          service.findByBarcode('EMD-000007', bordado),
        ).resolves.toMatchObject({ id: 7 });
      });

      it('un código con formato inválido da 400', async () => {
        await expect(service.findByBarcode('ÑÑÑ', admin)).rejects.toThrow(
          BadRequestException,
        );
        expect(prisma.inventoryItem.findUnique).not.toHaveBeenCalled();
      });
    });

    describe('movimiento por código', () => {
      it('SALIDA por escaneo resta del artículo encontrado', async () => {
        const result = await service.registerMovementByBarcode(
          'EMD-000007',
          { type: 'SALIDA', quantity: 1 },
          recepcion,
        );
        const movement = prisma.inventoryMovement.create.mock.calls[0][0].data;
        expect(movement.itemId).toBe(7);
        expect(Number(movement.delta)).toBe(-1);
        expect(Number(movement.balanceAfter)).toBe(9);
        expect(result.item).toMatchObject({ id: 7, barcode: 'EMD-000007' });
      });

      it('ENTRADA por escaneo suma la cantidad indicada', async () => {
        await service.registerMovementByBarcode(
          'EMD-000007',
          { type: 'ENTRADA', quantity: 3 },
          admin,
        );
        const movement = prisma.inventoryMovement.create.mock.calls[0][0].data;
        expect(Number(movement.balanceAfter)).toBe(13);
      });

      it('SALIDA mayor al stock se sigue rechazando', async () => {
        await expect(
          service.registerMovementByBarcode(
            'EMD-000007',
            { type: 'SALIDA', quantity: 11 },
            recepcion,
          ),
        ).rejects.toThrow('Stock insuficiente');
      });

      it('código desconocido da 404 y un rol de área 403, sin mover stock', async () => {
        await expect(
          service.registerMovementByBarcode(
            'NO-EXISTE',
            { type: 'ENTRADA', quantity: 1 },
            admin,
          ),
        ).rejects.toThrow(NotFoundException);
        await expect(
          service.registerMovementByBarcode(
            'EMD-000007',
            { type: 'ENTRADA', quantity: 1 },
            bordado,
          ),
        ).rejects.toThrow(ForbiddenException);
        expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
      });
    });
  });
});
