import { HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrderService } from 'src/order/order.service';
import { OrderMockupService } from 'src/order-mockup/order-mockup.service';
import { CreateOrderMockupDto } from 'src/order-mockup/dto/create-order-mockup.dto';
import { MockupTemplateService } from 'src/mockup-template/mockup-template.service';
import { CreateMockupTemplateDto } from 'src/mockup-template/dto/mockup-template.dto';
import { MockupLogoService } from 'src/mockup-logo/mockup-logo.service';
import { CreateMockupLogoDto } from 'src/mockup-logo/dto/mockup-logo.dto';
import { StorageService } from './storage.service';
import {
  createS3StorageForTests,
  InMemoryObjectStore,
} from './testing/in-memory-object-store';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_DATA_URL = `data:image/png;base64,${PNG}`;
const CREATED_AT = new Date('2026-10-05T12:00:00.000Z');
const AUTHOR = { id: 7, firstName: 'Ana', lastName: 'Ruiz', username: 'ana' };
const RECEPCION = { userId: 7, roles: ['recepcion'] };

const studioConfig = () => ({
  garment: 'tshirt',
  colors: { body: '#ffffff' },
  layers: [{ id: 'l1', name: 'logo.png', dataUrl: PNG_DATA_URL, aspect: 1 }],
});

/**
 * Mockups, plantillas y logos con almacenamiento de objetos: mismas
 * respuestas para filas legacy y migradas, escrituras al bucket con driver
 * `s3` y borrado del objeto al borrar la fila.
 */
describe('Mockups - almacenamiento de archivos (R2/S3)', () => {
  let store: InMemoryObjectStore;
  let storage: StorageService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    ({ store, storage } = createS3StorageForTests());
  });
  afterEach(() => jest.restoreAllMocks());

  describe('OrderMockupService', () => {
    let prisma: any;
    const build = (s: StorageService) =>
      new OrderMockupService(
        prisma as unknown as PrismaService,
        {
          assertOrderAccess: jest.fn().mockResolvedValue({ id: 10 }),
        } as unknown as OrderService,
        s,
      );

    beforeEach(() => {
      prisma = {
        orderMockup: {
          findFirst: jest.fn(),
          create: jest.fn().mockResolvedValue({
            id: 3,
            orderId: 10,
            garment: 'tshirt',
            createdAt: CREATED_AT,
            createdBy: AUTHOR,
          }),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
    });

    it('create (s3): la lámina va al bucket y la columna queda en null', async () => {
      await build(storage).create(
        10,
        {
          garment: 'tshirt',
          imageDataUrl: PNG_DATA_URL,
          config: studioConfig(),
        } as CreateOrderMockupDto,
        RECEPCION,
      );
      const data = prisma.orderMockup.create.mock.calls[0][0].data;
      expect(data.imageData).toBeNull();
      expect(data.imageKey).toMatch(/^orders\/mockups\/.+\.png$/);
      expect(store.base64(data.imageKey)).toBe(PNG);
    });

    it('findOne: fila migrada y legacy devuelven la misma data URL', async () => {
      await store.put(
        'orders/mockups/m.png',
        Buffer.from(PNG, 'base64'),
        'image/png',
      );
      const row = {
        id: 3,
        orderId: 10,
        garment: 'tshirt',
        createdAt: CREATED_AT,
        createdBy: AUTHOR,
        imageMime: 'image/png',
        config: studioConfig(),
      };
      prisma.orderMockup.findFirst
        .mockResolvedValueOnce({
          ...row,
          imageData: null,
          imageKey: 'orders/mockups/m.png',
        })
        .mockResolvedValueOnce({ ...row, imageData: PNG, imageKey: null });
      const service = build(storage);

      const migrated = await service.findOne(10, 3, RECEPCION);
      const legacy = await service.findOne(10, 3, RECEPCION);

      expect(migrated.dataUrl).toBe(PNG_DATA_URL);
      expect(legacy).toEqual(migrated);
      expect(
        prisma.orderMockup.findFirst.mock.calls[0][0].select,
      ).toMatchObject({ imageData: true, imageKey: true });
    });

    it('remove: borra la fila y después el objeto', async () => {
      await store.put('orders/mockups/m.png', Buffer.from('x'), 'image/png');
      prisma.orderMockup.findFirst.mockResolvedValue({
        imageKey: 'orders/mockups/m.png',
      });

      await build(storage).remove(10, 3, RECEPCION);

      expect(prisma.orderMockup.findFirst.mock.calls[0][0].where).toEqual({
        id: 3,
        orderId: 10,
      });
      expect(store.objects.size).toBe(0);
    });

    it('remove: 404 si no existe, sin tocar el bucket', async () => {
      await store.put('k', Buffer.from('x'), 'image/png');
      prisma.orderMockup.findFirst.mockResolvedValue(null);
      prisma.orderMockup.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        build(storage).remove(10, 3, RECEPCION),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
      expect(store.objects.size).toBe(1);
    });
  });

  describe('MockupTemplateService', () => {
    let prisma: any;
    const row = (overrides: Record<string, unknown> = {}) => ({
      id: 4,
      name: 'Playera',
      garment: 'tshirt',
      thumbnailData: null,
      thumbnailKey: null,
      thumbnailMime: 'image/png',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      createdBy: AUTHOR,
      ...overrides,
    });
    const build = (s: StorageService) =>
      new MockupTemplateService(prisma as unknown as PrismaService, s);

    beforeEach(() => {
      prisma = {
        mockupTemplate: {
          findMany: jest.fn(),
          findUnique: jest.fn(),
          create: jest.fn().mockResolvedValue(row({ thumbnailKey: 'x' })),
          update: jest.fn(),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
    });

    it('create (s3): miniatura al bucket; la respuesta trae la data URL sin releerla', async () => {
      const get = jest.spyOn(store, 'get');

      const result = await build(storage).create(
        {
          name: 'Playera',
          garment: 'tshirt',
          config: studioConfig(),
          thumbnailDataUrl: PNG_DATA_URL,
        } as CreateMockupTemplateDto,
        7,
      );

      const data = prisma.mockupTemplate.create.mock.calls[0][0].data;
      expect(data.thumbnailData).toBeNull();
      expect(store.base64(data.thumbnailKey)).toBe(PNG);
      expect(result.thumbnailUrl).toBe(PNG_DATA_URL);
      expect(get).not.toHaveBeenCalled();
    });

    it('findAll: mezcla legacy y migradas; una miniatura perdida no rompe el listado', async () => {
      await store.put('t.png', Buffer.from(PNG, 'base64'), 'image/png');
      prisma.mockupTemplate.findMany.mockResolvedValue([
        row({ id: 3, thumbnailKey: 't.png' }),
        row({ id: 2, thumbnailData: PNG }),
        row({ id: 1, thumbnailKey: 'perdida.png' }),
      ]);

      const result = await build(storage).findAll();

      expect(result.map((t) => t.thumbnailUrl)).toEqual([
        PNG_DATA_URL,
        PNG_DATA_URL,
        '',
      ]);
      expect(
        prisma.mockupTemplate.findMany.mock.calls[0][0].select,
      ).toMatchObject({ thumbnailData: true, thumbnailKey: true });
    });

    it('remove: borra el objeto de la miniatura', async () => {
      await store.put('t.png', Buffer.from('x'), 'image/png');
      prisma.mockupTemplate.findUnique.mockResolvedValue({
        thumbnailKey: 't.png',
      });

      await build(storage).remove(4);

      expect(store.objects.size).toBe(0);
    });
  });

  describe('MockupLogoService', () => {
    let prisma: any;
    const build = (s: StorageService) =>
      new MockupLogoService(prisma as unknown as PrismaService, s);
    const logoDto = {
      name: 'Logo',
      imageDataUrl: PNG_DATA_URL,
      thumbnailDataUrl: PNG_DATA_URL,
    } as CreateMockupLogoDto;

    beforeEach(() => {
      prisma = {
        mockupLogo: {
          findUnique: jest.fn(),
          create: jest.fn().mockResolvedValue({
            id: 5,
            name: 'Logo',
            useCount: 0,
            lastUsedAt: null,
            createdAt: CREATED_AT,
            createdBy: AUTHOR,
          }),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
    });

    it('create (s3): imagen y miniatura al bucket en carpetas distintas', async () => {
      await build(storage).create(logoDto, 7);

      const data = prisma.mockupLogo.create.mock.calls[0][0].data;
      expect(data.imageData).toBeNull();
      expect(data.thumbnailData).toBeNull();
      expect(data.imageKey).toMatch(/^mockup-logos\/images\//);
      expect(data.thumbnailKey).toMatch(/^mockup-logos\/thumbnails\//);
      expect(store.objects.size).toBe(2);
    });

    it('create (s3): si la fila no se crea, no quedan objetos', async () => {
      prisma.mockupLogo.create.mockRejectedValue(new Error('DB'));
      await expect(build(storage).create(logoDto, 7)).rejects.toThrow('DB');
      expect(store.objects.size).toBe(0);
    });

    it('create (s3): si falla la miniatura, borra la imagen ya subida', async () => {
      const put = jest.spyOn(store, 'put');
      put.mockImplementationOnce(InMemoryObjectStore.prototype.put.bind(store));
      put.mockRejectedValueOnce(new Error('R2'));

      await expect(build(storage).create(logoDto, 7)).rejects.toThrow('R2');
      expect(store.objects.size).toBe(0);
      expect(prisma.mockupLogo.create).not.toHaveBeenCalled();
    });

    it('findImage / findThumbnail leen el bucket', async () => {
      await store.put('i.png', Buffer.from(PNG, 'base64'), 'image/png');
      prisma.mockupLogo.findUnique.mockResolvedValue({
        imageData: null,
        imageKey: 'i.png',
        imageMime: 'image/png',
        thumbnailData: null,
        thumbnailKey: 'i.png',
        thumbnailMime: 'image/png',
      });
      const service = build(storage);

      await expect(service.findImage(5)).resolves.toEqual({
        dataUrl: PNG_DATA_URL,
      });
      await expect(service.findThumbnail(5)).resolves.toEqual({
        dataUrl: PNG_DATA_URL,
      });
    });

    it('remove: borra imagen y miniatura del bucket', async () => {
      await store.put('i.png', Buffer.from('x'), 'image/png');
      await store.put('t.png', Buffer.from('x'), 'image/png');
      prisma.mockupLogo.findUnique.mockResolvedValue({
        imageKey: 'i.png',
        thumbnailKey: 't.png',
      });

      await build(storage).remove(5);

      expect(store.objects.size).toBe(0);
    });

    it('driver db: create guarda el base64 como siempre', async () => {
      await build(StorageService.database()).create(logoDto, 7);
      const data = prisma.mockupLogo.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        imageData: PNG,
        imageKey: null,
        thumbnailData: PNG,
        thumbnailKey: null,
      });
    });
  });
});
