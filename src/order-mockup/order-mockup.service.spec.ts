import { HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrderService, RequestingUser } from 'src/order/order.service';
import {
  CreateOrderMockupDto,
  MAX_MOCKUP_BYTES,
} from './dto/create-order-mockup.dto';
import { OrderMockupService } from './order-mockup.service';

// PNG mínimo válido (mismo que order.file-validation.spec.ts): file-type lo
// detecta como image/png por magic bytes.
const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_DATA_URL = `data:image/png;base64,${MINIMAL_PNG_BASE64}`;
// Cabecera JFIF: alcanza para que file-type lo detecte como image/jpeg.
const MINIMAL_JPEG_BASE64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]).toString('base64');

const RECEPCION: RequestingUser = { userId: 7, roles: ['recepcion'] };
const CREATED_AT = new Date('2026-10-05T12:00:00.000Z');

const config = (overrides: Record<string, unknown> = {}) => ({
  garment: 'tshirt',
  colors: { body: '#ffffff' },
  layers: [
    {
      id: 'l1',
      name: 'logo.png',
      dataUrl: PNG_DATA_URL,
      aspect: 1,
      placement: {
        position: [0, 0.2, 0.1],
        normal: [0, 0, 1],
        scale: 0.3,
        rotation: 0,
      },
    },
  ],
  ...overrides,
});

const dto = (
  overrides: Partial<Record<keyof CreateOrderMockupDto, unknown>> = {},
): CreateOrderMockupDto =>
  ({
    garment: 'tshirt',
    imageDataUrl: PNG_DATA_URL,
    config: config(),
    ...overrides,
  }) as CreateOrderMockupDto;

const summaryRow = (overrides: Record<string, unknown> = {}) => ({
  id: 3,
  orderId: 10,
  garment: 'tshirt',
  createdAt: CREATED_AT,
  createdBy: { id: 7, firstName: 'Ana', lastName: 'Ruiz', username: 'ana' },
  ...overrides,
});

/** Base64 cuyo contenido decodificado pesa exactamente `bytes`. */
const base64OfBytes = (bytes: number) =>
  Buffer.alloc(bytes, 0).toString('base64');

describe('OrderMockupService', () => {
  let service: OrderMockupService;
  let prisma: {
    orderMockup: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let orderService: { assertOrderAccess: jest.Mock };

  beforeEach(() => {
    prisma = {
      orderMockup: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(summaryRow()),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    orderService = {
      assertOrderAccess: jest.fn().mockResolvedValue({ id: 10 }),
    };
    service = new OrderMockupService(
      prisma as unknown as PrismaService,
      orderService as unknown as OrderService,
    );
  });

  /** Ejecuta `fn` y devuelve el status de la HttpException que lanza. */
  const statusOf = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      return (error as HttpException).getStatus();
    }
    throw new Error('Se esperaba una HttpException');
  };

  describe('create', () => {
    it('guarda la imagen sin el prefijo data:, su mime, la config y el autor, y devuelve el resumen', async () => {
      const result = await service.create(10, dto(), RECEPCION);

      expect(orderService.assertOrderAccess).toHaveBeenCalledWith(
        10,
        RECEPCION,
      );
      const args = prisma.orderMockup.create.mock.calls[0][0];
      expect(args.data).toEqual({
        orderId: 10,
        garment: 'tshirt',
        imageData: MINIMAL_PNG_BASE64,
        // Driver `db` (default): el base64 en la columna, sin clave.
        imageKey: null,
        imageMime: 'image/png',
        config: config(),
        createdById: 7,
      });
      // La respuesta del POST tampoco arrastra la imagen.
      expect(args.select.imageData).toBeUndefined();
      expect(args.select.config).toBeUndefined();
      expect(result).toEqual({
        id: 3,
        orderId: 10,
        garment: 'tshirt',
        createdAt: '2026-10-05T12:00:00.000Z',
        createdBy: { id: 7, name: 'Ana Ruiz' },
      });
    });

    it('acepta una lámina JPEG y guarda image/jpeg', async () => {
      await service.create(
        10,
        dto({
          garment: 'cap',
          imageDataUrl: `data:image/jpeg;base64,${MINIMAL_JPEG_BASE64}`,
          config: config({
            garment: 'cap',
            colors: { body: '#111', mesh: '#fff', visor: '#111' },
            layers: [],
          }),
        }),
        RECEPCION,
      );

      const { data } = prisma.orderMockup.create.mock.calls[0][0];
      expect(data.imageMime).toBe('image/jpeg');
      expect(data.imageData).toBe(MINIMAL_JPEG_BASE64);
      expect(data.garment).toBe('cap');
    });

    it.each([
      ['404 (pedido inexistente)', HttpStatus.NOT_FOUND],
      ['403 (pedido de otra área)', HttpStatus.FORBIDDEN],
    ])(
      'propaga el %s de assertOrderAccess y no guarda nada',
      async (_label, status) => {
        orderService.assertOrderAccess.mockRejectedValue(
          new HttpException('x', status),
        );

        expect(await statusOf(() => service.create(10, dto(), RECEPCION))).toBe(
          status,
        );
        expect(prisma.orderMockup.create).not.toHaveBeenCalled();
      },
    );

    it('rechaza una prenda fuera de la lista compartida con 400', async () => {
      expect(
        await statusOf(() =>
          service.create(10, dto({ garment: 'pants' }), RECEPCION),
        ),
      ).toBe(HttpStatus.BAD_REQUEST);
      expect(prisma.orderMockup.create).not.toHaveBeenCalled();
    });

    it.each(['hoodie', 'dress-shirt', 'termo', 'taza'])(
      'acepta %s (misma lista de prendas que las plantillas, decisión R11)',
      async (garment) => {
        await service.create(
          10,
          dto({ garment, config: config({ garment }) }),
          RECEPCION,
        );
        expect(prisma.orderMockup.create.mock.calls[0][0].data.garment).toBe(
          garment,
        );
      },
    );

    it.each([
      [
        'un mime que no es PNG/JPEG',
        `data:image/gif;base64,R0lGODlhAQABAAAAACw=`,
      ],
      ['un SVG', `data:image/svg+xml;base64,PHN2Zy8+`],
      ['algo que no es data URL', MINIMAL_PNG_BASE64],
      ['un data URL sin base64', 'data:image/png,abc'],
    ])('rechaza %s con 400', async (_label, imageDataUrl) => {
      expect(
        await statusOf(() =>
          service.create(10, dto({ imageDataUrl }), RECEPCION),
        ),
      ).toBe(HttpStatus.BAD_REQUEST);
      expect(prisma.orderMockup.create).not.toHaveBeenCalled();
    });

    // Buffer.from(…, 'base64') ignora caracteres inválidos y corta en el
    // padding: sin validar el string, los magic bytes pasan pero se guarda
    // basura (y un NUL hace fallar el INSERT en Postgres con un 500).
    it.each([
      ['basura después del padding', `${MINIMAL_PNG_BASE64}"><x`],
      ['un NUL', `${MINIMAL_PNG_BASE64}\u0000`],
      [
        'espacios en medio',
        `${MINIMAL_PNG_BASE64.slice(0, 8)} ${MINIMAL_PNG_BASE64.slice(8)}`,
      ],
      ['un string vacío', ''],
    ])(
      'rechaza con 400 una imagen PNG válida con %s en el base64',
      async (_label, base64) => {
        expect(
          await statusOf(() =>
            service.create(
              10,
              dto({ imageDataUrl: `data:image/png;base64,${base64}` }),
              RECEPCION,
            ),
          ),
        ).toBe(HttpStatus.BAD_REQUEST);
        expect(prisma.orderMockup.create).not.toHaveBeenCalled();
      },
    );

    it('rechaza con 400 una configuración con un NUL (jsonb de Postgres no lo acepta)', async () => {
      const layer = { ...config().layers[0], name: 'logo\u0000.png' };

      expect(
        await statusOf(() =>
          service.create(
            10,
            dto({ config: config({ layers: [layer] }) }),
            RECEPCION,
          ),
        ),
      ).toBe(HttpStatus.BAD_REQUEST);
      expect(prisma.orderMockup.create).not.toHaveBeenCalled();
    });

    it('rechaza con 400 un contenido que no es PNG aunque se declare image/png', async () => {
      const fake = Buffer.from('<script>alert(1)</script>').toString('base64');

      expect(
        await statusOf(() =>
          service.create(
            10,
            dto({ imageDataUrl: `data:image/png;base64,${fake}` }),
            RECEPCION,
          ),
        ),
      ).toBe(HttpStatus.BAD_REQUEST);
      expect(prisma.orderMockup.create).not.toHaveBeenCalled();
    });

    it('rechaza con 413 una imagen de más de 8MB decodificada', async () => {
      const imageDataUrl = `data:image/png;base64,${base64OfBytes(MAX_MOCKUP_BYTES + 1)}`;

      expect(
        await statusOf(() =>
          service.create(10, dto({ imageDataUrl }), RECEPCION),
        ),
      ).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
      expect(prisma.orderMockup.create).not.toHaveBeenCalled();
    });

    it('rechaza con 413 una configuración (diseños embebidos) de más de 8MB', async () => {
      const bigLayer = {
        ...config().layers[0],
        dataUrl: `data:image/png;base64,${'A'.repeat(MAX_MOCKUP_BYTES)}`,
      };

      expect(
        await statusOf(() =>
          service.create(
            10,
            dto({ config: config({ layers: [bigLayer] }) }),
            RECEPCION,
          ),
        ),
      ).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
      expect(prisma.orderMockup.create).not.toHaveBeenCalled();
    });

    it('rechaza con 413 cuando imagen + configuración juntas pasan de 8MB aunque cada una entre', async () => {
      // ~5MB de imagen en base64 + ~4MB de diseños: cada parte < 8MB.
      const imageDataUrl = `data:image/png;base64,${'A'.repeat(5 * 1024 * 1024)}`;
      const layer = {
        ...config().layers[0],
        dataUrl: `data:image/png;base64,${'A'.repeat(4 * 1024 * 1024)}`,
      };

      expect(
        await statusOf(() =>
          service.create(
            10,
            dto({ imageDataUrl, config: config({ layers: [layer] }) }),
            RECEPCION,
          ),
        ),
      ).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
      expect(prisma.orderMockup.create).not.toHaveBeenCalled();
    });

    it.each([
      ['de otra prenda', { garment: 'cap' }],
      ['sin colores', { colors: undefined }],
      ['con layers que no es array', { layers: {} }],
      ['con un diseño que no es objeto', { layers: ['x'] }],
      [
        'con un diseño JPEG (deben ser PNG)',
        {
          layers: [
            { ...config().layers[0], dataUrl: 'data:image/jpeg;base64,AAAA' },
          ],
        },
      ],
    ])('rechaza con 400 una configuración %s', async (_label, overrides) => {
      expect(
        await statusOf(() =>
          service.create(10, dto({ config: config(overrides) }), RECEPCION),
        ),
      ).toBe(HttpStatus.BAD_REQUEST);
      expect(prisma.orderMockup.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('lista sin imageData ni config, más nuevos primero, sólo del pedido pedido', async () => {
      prisma.orderMockup.findMany.mockResolvedValue([
        summaryRow({ id: 5 }),
        summaryRow({
          id: 4,
          createdBy: {
            id: 8,
            firstName: '',
            lastName: null,
            username: 'taller1',
          },
        }),
        summaryRow({ id: 2, createdBy: null }),
      ]);

      const result = await service.findAll(10, RECEPCION);

      expect(orderService.assertOrderAccess).toHaveBeenCalledWith(
        10,
        RECEPCION,
      );
      const args = prisma.orderMockup.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ orderId: 10 });
      expect(Object.keys(args.select).sort()).toEqual(
        ['createdAt', 'createdBy', 'garment', 'id', 'orderId'].sort(),
      );
      expect(args.select).not.toHaveProperty('imageData');
      expect(args.select).not.toHaveProperty('config');
      // El autor nunca trae password ni roles.
      expect(Object.keys(args.select.createdBy.select).sort()).toEqual(
        ['firstName', 'id', 'lastName', 'username'].sort(),
      );
      expect(args.orderBy[0]).toEqual({ createdAt: 'desc' });

      expect(result.map((m) => m.id)).toEqual([5, 4, 2]);
      expect(result[0].createdBy).toEqual({ id: 7, name: 'Ana Ruiz' });
      // Sin nombre cargado cae al username.
      expect(result[1].createdBy).toEqual({ id: 8, name: 'taller1' });
      expect(result[2].createdBy).toBeNull();
      expect(result[0].createdAt).toBe('2026-10-05T12:00:00.000Z');
      expect(result[0]).not.toHaveProperty('imageData');
    });

    it('no consulta mockups si assertOrderAccess rechaza (403)', async () => {
      orderService.assertOrderAccess.mockRejectedValue(
        new HttpException('Sin acceso', HttpStatus.FORBIDDEN),
      );

      expect(await statusOf(() => service.findAll(10, RECEPCION))).toBe(
        HttpStatus.FORBIDDEN,
      );
      expect(prisma.orderMockup.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('devuelve el resumen + dataUrl armado con el mime guardado + config', async () => {
      prisma.orderMockup.findFirst.mockResolvedValue({
        ...summaryRow(),
        imageData: MINIMAL_JPEG_BASE64,
        imageMime: 'image/jpeg',
        config: config(),
      });

      const result = await service.findOne(10, 3, RECEPCION);

      expect(prisma.orderMockup.findFirst.mock.calls[0][0].where).toEqual({
        id: 3,
        orderId: 10,
      });
      expect(result).toEqual({
        id: 3,
        orderId: 10,
        garment: 'tshirt',
        createdAt: '2026-10-05T12:00:00.000Z',
        createdBy: { id: 7, name: 'Ana Ruiz' },
        dataUrl: `data:image/jpeg;base64,${MINIMAL_JPEG_BASE64}`,
        config: config(),
      });
    });

    it('responde 404 si el mockup no existe o es de otro pedido', async () => {
      prisma.orderMockup.findFirst.mockResolvedValue(null);

      expect(await statusOf(() => service.findOne(10, 99, RECEPCION))).toBe(
        HttpStatus.NOT_FOUND,
      );
    });

    it('no lee el mockup si assertOrderAccess rechaza (403)', async () => {
      orderService.assertOrderAccess.mockRejectedValue(
        new HttpException('Sin acceso', HttpStatus.FORBIDDEN),
      );

      expect(await statusOf(() => service.findOne(10, 3, RECEPCION))).toBe(
        HttpStatus.FORBIDDEN,
      );
      expect(prisma.orderMockup.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('borra sólo el mockup de ese pedido', async () => {
      await expect(service.remove(10, 3, RECEPCION)).resolves.toBeUndefined();

      expect(orderService.assertOrderAccess).toHaveBeenCalledWith(
        10,
        RECEPCION,
      );
      expect(prisma.orderMockup.deleteMany).toHaveBeenCalledWith({
        where: { id: 3, orderId: 10 },
      });
    });

    it('responde 404 si no borró nada (no existe o es de otro pedido)', async () => {
      prisma.orderMockup.deleteMany.mockResolvedValue({ count: 0 });

      expect(await statusOf(() => service.remove(10, 3, RECEPCION))).toBe(
        HttpStatus.NOT_FOUND,
      );
    });

    it('no borra nada si assertOrderAccess rechaza (404)', async () => {
      orderService.assertOrderAccess.mockRejectedValue(
        new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND),
      );

      expect(await statusOf(() => service.remove(10, 3, RECEPCION))).toBe(
        HttpStatus.NOT_FOUND,
      );
      expect(prisma.orderMockup.deleteMany).not.toHaveBeenCalled();
    });
  });
});
