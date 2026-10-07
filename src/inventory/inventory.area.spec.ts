import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

/**
 * Inventario por área: los usuarios de producción sólo ven y mueven SUS
 * artículos, cada cambio deja bitácora y avisa a Recepción, y las
 * solicitudes de reabasto recorren pendiente → en camino/comprado → resuelto.
 */
const recepcion = { sub: 1, roles: ['recepcion'] };
const bordado = { sub: 20, roles: ['bordado'] };
const dtf = { sub: 30, roles: ['dtf'] };
const multi = { sub: 40, roles: ['taller', 'laser'] };

const itemRow = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  area: 'bordado',
  name: 'Hilo poliéster rojo',
  sku: null,
  barcode: 'EMD-000007',
  category: 'Hilos',
  unit: 'cono',
  color: null,
  brand: null,
  location: null,
  quantity: new Prisma.Decimal(10),
  minStock: new Prisma.Decimal(2),
  unitCost: null,
  notes: null,
  materialId: null,
  supplierId: null,
  createdAt: new Date('2026-10-01T12:00:00Z'),
  updatedAt: new Date('2026-10-01T12:00:00Z'),
  material: null,
  supplier: null,
  ...overrides,
});

const restockRow = (overrides: Record<string, unknown> = {}) => ({
  id: 3,
  area: 'bordado',
  itemId: 7,
  itemName: 'Hilo poliéster rojo',
  quantity: new Prisma.Decimal(5),
  unit: 'cono',
  comment: 'Se acabó el rojo',
  urgency: 'NORMAL',
  status: 'PENDIENTE',
  statusNote: null,
  resolvedAt: null,
  createdAt: new Date('2026-10-07T10:00:00Z'),
  updatedAt: new Date('2026-10-07T10:00:00Z'),
  item: {
    id: 7,
    name: 'Hilo poliéster rojo',
    unit: 'cono',
    quantity: new Prisma.Decimal(0),
    area: 'bordado',
  },
  requestedBy: { id: 20, firstName: 'Ana', lastName: 'Bordado' },
  handledBy: null,
  ...overrides,
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('Inventario por área', () => {
  let service: InventoryService;
  let prisma: any;
  let notifications: {
    userIdsForArea: jest.Mock;
    createNotificationForUsers: jest.Mock;
    createNotification: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      inventoryItem: {
        findMany: jest.fn().mockResolvedValue([itemRow()]),
        findUnique: jest.fn().mockResolvedValue(itemRow()),
        update: jest.fn(),
      },
      inventoryMovement: {
        create: jest.fn((args: { data: Record<string, unknown> }) => ({
          id: 1,
          ...args.data,
          unitCost: null,
        })),
        findMany: jest.fn().mockResolvedValue([]),
      },
      restockRequest: {
        create: jest.fn().mockResolvedValue(restockRow()),
        findMany: jest.fn().mockResolvedValue([restockRow()]),
        findUnique: jest.fn().mockResolvedValue({ id: 3, status: 'PENDIENTE' }),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(2),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ firstName: 'Ana', lastName: 'Bordado' }),
      },
      order: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
      // Insumos apartados por hojas de materiales (no hay ninguno en estas pruebas).
      orderAreaSupplyLine: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ quantity: new Prisma.Decimal(10) }]),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
    notifications = {
      userIdsForArea: jest.fn((role: string) =>
        Promise.resolve(role === 'recepcion' ? [1, 2] : [9]),
      ),
      createNotificationForUsers: jest.fn().mockResolvedValue(undefined),
      createNotification: jest.fn().mockResolvedValue(null),
    };
    service = new InventoryService(
      prisma as PrismaService,
      notifications as unknown as NotificationService,
    );
  });

  describe('alcance en cada endpoint', () => {
    it('GET /inventory: el área sólo consulta sus artículos y no puede pedir otra', async () => {
      await service.findAll(bordado);
      expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { area: { in: ['bordado'] } } }),
      );
      await expect(service.findAll(bordado, 'dtf')).rejects.toThrow(
        ForbiddenException,
      );
      expect(service.areasFor(multi.roles)).toEqual(['taller', 'laser']);
    });

    it('GET /inventory/:id de otra área da 403', async () => {
      await expect(service.findOne(7, dtf)).rejects.toThrow(ForbiddenException);
      await expect(service.findOne(7, bordado)).resolves.toMatchObject({
        id: 7,
      });
    });

    it('escaneo por código de otra área da 404 (no revela el artículo)', async () => {
      await expect(service.findByBarcode('EMD-000007', dtf)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.findByBarcode('EMD-000007', bordado),
      ).resolves.toMatchObject({ id: 7 });
    });

    it('movimiento sobre artículo de otra área: 403 por id y 404 por código', async () => {
      await expect(
        service.registerMovement(7, { type: 'SALIDA', quantity: 1 }, dtf),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.registerMovementByBarcode(
          'EMD-000007',
          { type: 'SALIDA', quantity: 1 },
          dtf,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('la bitácora y las solicitudes se recortan a las áreas visibles', async () => {
      await expect(
        service.findMovements(bordado, { area: 'dtf' }),
      ).rejects.toThrow(ForbiddenException);
      await service.findRestockRequests(bordado, {});
      expect(prisma.restockRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { area: { in: ['bordado'] } },
        }),
      );
      await expect(
        service.findRestockRequests(bordado, { area: 'dtf' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('cambiar el estado de una solicitud es sólo de Recepción/admin', async () => {
      await expect(
        service.updateRestockStatus(3, { status: 'RESUELTO' }, bordado),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.restockRequest.update).not.toHaveBeenCalled();
    });
  });

  describe('movimientos del área y bitácora', () => {
    it('registrar consumo descuenta y guarda quién, antes/después, motivo, área y origen', async () => {
      await service.registerMovement(
        7,
        { type: 'SALIDA', quantity: 3, reason: 'Pedido 120' },
        bordado,
      );
      expect(prisma.inventoryItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { quantity: new Prisma.Decimal(7) },
        }),
      );
      const data = prisma.inventoryMovement.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        type: 'SALIDA',
        area: 'bordado',
        reason: 'Pedido 120',
        source: 'area',
        createdById: 20,
      });
      expect(Number(data.delta)).toBe(-3);
      expect(Number(data.balanceBefore)).toBe(10);
      expect(Number(data.balanceAfter)).toBe(7);
    });

    it('registrar entrada suma y avisa a Recepción y admin (sin el autor)', async () => {
      await service.registerMovement(
        7,
        { type: 'ENTRADA', quantity: 4, note: 'Lo trajo el proveedor' },
        bordado,
      );
      await flush();
      const data = prisma.inventoryMovement.create.mock.calls[0][0].data;
      expect(Number(data.balanceAfter)).toBe(14);
      expect(data.reason).toBe('Lo trajo el proveedor');
      expect(notifications.createNotificationForUsers).toHaveBeenCalledWith(
        [1, 2, 9],
        expect.objectContaining({
          type: 'inventory_area_movement',
          title: 'Entrada en Bordado: Hilo poliéster rojo',
          body: 'Ana Bordado sumó 4 cono · 10 → 14',
        }),
      );
    });

    it('el consumo del área también avisa', async () => {
      await service.registerMovement(
        7,
        { type: 'SALIDA', quantity: 1 },
        bordado,
      );
      await flush();
      expect(notifications.createNotificationForUsers).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          title: 'Consumo en Bordado: Hilo poliéster rojo',
        }),
      );
    });

    it('por escáner queda con origen "area" para el área y "scan" para Recepción', async () => {
      await service.registerMovementByBarcode(
        'EMD-000007',
        { type: 'ENTRADA', quantity: 1 },
        bordado,
      );
      await service.registerMovementByBarcode(
        'EMD-000007',
        { type: 'ENTRADA', quantity: 1 },
        recepcion,
      );
      const sources = prisma.inventoryMovement.create.mock.calls.map(
        (call: any[]) => call[0].data.source,
      );
      expect(sources).toEqual(['area', 'scan']);
    });

    it('los movimientos de Recepción no generan aviso de área', async () => {
      await service.registerMovement(
        7,
        { type: 'ENTRADA', quantity: 1 },
        recepcion,
      );
      await flush();
      expect(notifications.createNotificationForUsers).not.toHaveBeenCalled();
      expect(prisma.inventoryMovement.create.mock.calls[0][0].data.source).toBe(
        'recepcion',
      );
    });

    it('la bitácora global filtra por área, usuario, tipo y rango de fechas', async () => {
      await service.findMovements(recepcion, {
        area: 'bordado',
        userId: 20,
        type: 'SALIDA',
        from: '2026-10-01',
        to: '2026-10-07',
      });
      const { where } = prisma.inventoryMovement.findMany.mock.calls[0][0];
      expect(where).toEqual({
        OR: [
          { area: { in: ['bordado'] } },
          { area: null, item: { area: { in: ['bordado'] } } },
        ],
        createdById: 20,
        type: 'SALIDA',
        createdAt: {
          gte: new Date('2026-10-01'),
          lt: new Date('2026-10-08'),
        },
      });
    });

    it('historial por artículo sólo filtra por el artículo', async () => {
      await service.findMovements(recepcion, { itemId: 7, limit: 500 });
      const args = prisma.inventoryMovement.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ itemId: 7 });
      expect(args.take).toBe(500);
    });
  });

  describe('solicitudes de reabasto', () => {
    it('el área avisa sobre un artículo suyo; toma nombre, unidad y área del artículo', async () => {
      await service.createRestockRequest(
        { itemId: 7, quantity: 5, comment: 'Se acabó el rojo' },
        bordado,
      );
      await flush();
      expect(prisma.restockRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            area: 'bordado',
            itemId: 7,
            itemName: 'Hilo poliéster rojo',
            unit: 'cono',
            quantity: 5,
            urgency: 'NORMAL',
            requestedById: 20,
          }),
        }),
      );
      expect(notifications.createNotificationForUsers).toHaveBeenCalledWith(
        [1, 2, 9],
        expect.objectContaining({
          type: 'inventory_restock_request',
          title: 'Reabasto Bordado: Hilo poliéster rojo',
          body: 'Ana Bordado · 5 cono · Se acabó el rojo',
        }),
      );
    });

    it('no puede pedir reabasto de un artículo de otra área', async () => {
      await expect(
        service.createRestockRequest({ itemId: 7 }, dtf),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.restockRequest.create).not.toHaveBeenCalled();
    });

    it('texto libre: usa su única área; con varias pide indicarla', async () => {
      prisma.restockRequest.create.mockResolvedValue(
        restockRow({
          area: 'dtf',
          itemId: null,
          item: null,
          urgency: 'URGENTE',
        }),
      );
      await service.createRestockRequest(
        { itemName: 'Film DTF 60cm', urgency: 'URGENTE' },
        dtf,
      );
      expect(prisma.restockRequest.create.mock.calls[0][0].data).toMatchObject({
        area: 'dtf',
        itemId: null,
        itemName: 'Film DTF 60cm',
      });
      await flush();
      expect(
        notifications.createNotificationForUsers.mock.calls[0][1].title,
      ).toMatch(/^URGENTE · Reabasto DTF/);

      await expect(
        service.createRestockRequest({ itemName: 'Lija' }, multi),
      ).rejects.toThrow('Indica de qué departamento');
      await expect(
        service.createRestockRequest({ itemName: 'Lija', area: 'dtf' }, multi),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.createRestockRequest({}, dtf)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ciclo pendiente → en camino → resuelto, avisando a quien pidió', async () => {
      prisma.restockRequest.update.mockResolvedValueOnce(
        restockRow({ status: 'EN_CAMINO', statusNote: 'Llega el jueves' }),
      );
      const enCamino = await service.updateRestockStatus(
        3,
        { status: 'EN_CAMINO', note: 'Llega el jueves' },
        recepcion,
      );
      expect(enCamino.status).toBe('EN_CAMINO');
      expect(prisma.restockRequest.update.mock.calls[0][0].data).toMatchObject({
        status: 'EN_CAMINO',
        handledById: 1,
        resolvedAt: null,
      });
      expect(notifications.createNotification).toHaveBeenCalledWith({
        userId: 20,
        type: 'inventory_restock_status',
        title: 'Reabasto en camino: Hilo poliéster rojo',
        body: 'Llega el jueves',
      });

      prisma.restockRequest.findUnique.mockResolvedValue({
        id: 3,
        status: 'EN_CAMINO',
      });
      prisma.restockRequest.update.mockResolvedValueOnce(
        restockRow({ status: 'RESUELTO' }),
      );
      await service.updateRestockStatus(3, { status: 'RESUELTO' }, recepcion);
      expect(
        prisma.restockRequest.update.mock.calls[1][0].data.resolvedAt,
      ).toBeInstanceOf(Date);
      expect(notifications.createNotification).toHaveBeenCalledTimes(2);
    });

    it('sin cambio de estado no vuelve a avisar; solicitud inexistente da 404', async () => {
      prisma.restockRequest.update.mockResolvedValue(restockRow());
      await service.updateRestockStatus(
        3,
        { status: 'PENDIENTE', note: 'Revisando' },
        recepcion,
      );
      expect(notifications.createNotification).not.toHaveBeenCalled();
      prisma.restockRequest.findUnique.mockResolvedValue(null);
      await expect(
        service.updateRestockStatus(99, { status: 'RESUELTO' }, recepcion),
      ).rejects.toThrow(NotFoundException);
    });

    it('bandeja de abiertas y conteo para el badge', async () => {
      await service.findRestockRequests(recepcion, { open: 'true' });
      expect(prisma.restockRequest.findMany.mock.calls[0][0].where).toEqual({
        area: { in: expect.arrayContaining(['bordado', 'recepcion']) },
        status: { not: 'RESUELTO' },
      });
      await expect(service.restockPendingCount(recepcion)).resolves.toEqual({
        pending: 2,
        open: 2,
      });
    });
  });
});
