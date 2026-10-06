import { HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateMockupTemplateDto,
  MAX_MOCKUP_TEMPLATE_CONFIG_BYTES,
  MAX_MOCKUP_TEMPLATE_THUMBNAIL_BYTES,
} from './dto/mockup-template.dto';
import { MockupTemplateService } from './mockup-template.service';

// PNG mínimo válido (mismo que order-mockup.service.spec.ts).
const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_DATA_URL = `data:image/png;base64,${MINIMAL_PNG_BASE64}`;
// Cabecera JFIF: alcanza para que file-type lo detecte como image/jpeg.
const MINIMAL_JPEG_BASE64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]).toString('base64');

const CREATED_AT = new Date('2026-10-05T12:00:00.000Z');
const UPDATED_AT = new Date('2026-10-05T13:00:00.000Z');

const config = (overrides: Record<string, unknown> = {}) => ({
  garment: 'tshirt',
  colors: { body: '#ffffff' },
  layers: [{ id: 'l1', name: 'logo.png', dataUrl: PNG_DATA_URL, aspect: 1 }],
  ...overrides,
});

const dto = (
  overrides: Partial<Record<keyof CreateMockupTemplateDto, unknown>> = {},
): CreateMockupTemplateDto =>
  ({
    name: 'Playera blanca con logo',
    garment: 'tshirt',
    config: config(),
    thumbnailDataUrl: PNG_DATA_URL,
    ...overrides,
  }) as CreateMockupTemplateDto;

const summaryRow = (overrides: Record<string, unknown> = {}) => ({
  id: 4,
  name: 'Playera blanca con logo',
  garment: 'tshirt',
  thumbnailData: MINIMAL_PNG_BASE64,
  thumbnailMime: 'image/png',
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  createdBy: { id: 7, firstName: 'Ana', lastName: 'Ruiz', username: 'ana' },
  ...overrides,
});

const SUMMARY = {
  id: 4,
  name: 'Playera blanca con logo',
  garment: 'tshirt',
  thumbnailUrl: PNG_DATA_URL,
  createdAt: '2026-10-05T12:00:00.000Z',
  updatedAt: '2026-10-05T13:00:00.000Z',
  createdBy: { id: 7, name: 'Ana Ruiz' },
};

/** Base64 cuyo contenido decodificado pesa exactamente `bytes`. */
const base64OfBytes = (bytes: number) =>
  Buffer.alloc(bytes, 0).toString('base64');

describe('MockupTemplateService', () => {
  let service: MockupTemplateService;
  let prisma: {
    mockupTemplate: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      mockupTemplate: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(summaryRow()),
        update: jest.fn().mockResolvedValue(summaryRow()),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new MockupTemplateService(prisma as unknown as PrismaService);
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

  describe('findAll', () => {
    it('lista más nuevas primero, con miniatura como data URL y sin config', async () => {
      prisma.mockupTemplate.findMany.mockResolvedValue([
        summaryRow(),
        summaryRow({
          id: 2,
          garment: 'cap',
          thumbnailData: MINIMAL_JPEG_BASE64,
          thumbnailMime: 'image/jpeg',
          createdBy: { id: 9, firstName: '', lastName: null, username: 'beto' },
        }),
        summaryRow({ id: 1, createdBy: null }),
      ]);

      const result = await service.findAll();

      const args = prisma.mockupTemplate.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
      expect(args.select.config).toBeUndefined();
      expect(args.select.thumbnailData).toBe(true);
      expect(args.where).toBeUndefined();
      expect(result).toEqual([
        SUMMARY,
        {
          ...SUMMARY,
          id: 2,
          garment: 'cap',
          thumbnailUrl: `data:image/jpeg;base64,${MINIMAL_JPEG_BASE64}`,
          createdBy: { id: 9, name: 'beto' },
        },
        { ...SUMMARY, id: 1, createdBy: null },
      ]);
    });
  });

  describe('findOne', () => {
    it('devuelve el resumen más la config', async () => {
      prisma.mockupTemplate.findUnique.mockResolvedValue({
        ...summaryRow(),
        config: config(),
      });

      const result = await service.findOne(4);

      const args = prisma.mockupTemplate.findUnique.mock.calls[0][0];
      expect(args.where).toEqual({ id: 4 });
      expect(args.select.config).toBe(true);
      expect(result).toEqual({ ...SUMMARY, config: config() });
    });

    it('responde 404 si no existe', async () => {
      expect(await statusOf(() => service.findOne(99))).toBe(
        HttpStatus.NOT_FOUND,
      );
    });
  });

  describe('create', () => {
    it('guarda nombre (sin espacios de más), prenda, config, miniatura sin prefijo y autor', async () => {
      const result = await service.create(
        dto({ name: '  Playera blanca con logo  ' }),
        7,
      );

      const args = prisma.mockupTemplate.create.mock.calls[0][0];
      expect(args.data).toEqual({
        name: 'Playera blanca con logo',
        garment: 'tshirt',
        config: config(),
        thumbnailData: MINIMAL_PNG_BASE64,
        thumbnailMime: 'image/png',
        createdById: 7,
      });
      // La respuesta del POST no arrastra la config.
      expect(args.select.config).toBeUndefined();
      expect(result).toEqual(SUMMARY);
    });

    it.each(['cap', 'hoodie', 'dress-shirt'])(
      'acepta la prenda %s con miniatura JPEG',
      async (garment) => {
        await service.create(
          dto({
            garment,
            config: config({ garment }),
            thumbnailDataUrl: `data:image/jpeg;base64,${MINIMAL_JPEG_BASE64}`,
          }),
          7,
        );
        const { data } = prisma.mockupTemplate.create.mock.calls[0][0];
        expect(data.garment).toBe(garment);
        expect(data.thumbnailMime).toBe('image/jpeg');
      },
    );

    it.each<[string, Partial<Record<keyof CreateMockupTemplateDto, unknown>>]>([
      ['nombre vacío', { name: '   ' }],
      ['nombre de más de 80 caracteres', { name: 'x'.repeat(81) }],
      [
        'prenda desconocida',
        { garment: 'pants', config: config({ garment: 'pants' }) },
      ],
      ['config que no es objeto', { config: [] }],
      ['config de otra prenda', { config: config({ garment: 'cap' }) }],
      ['config sin colores', { config: config({ colors: undefined }) }],
      ['config sin layers', { config: config({ layers: {} }) }],
      ['diseño que no es objeto', { config: config({ layers: ['x'] }) }],
      [
        'diseño que no es PNG',
        {
          config: config({
            layers: [{ dataUrl: 'data:image/svg+xml;base64,AAAA' }],
          }),
        },
      ],
      ['config con NUL', { config: config({ note: 'a\u0000b' }) }],
      [
        'miniatura que no es data URL',
        { thumbnailDataUrl: MINIMAL_PNG_BASE64 },
      ],
      ['miniatura GIF', { thumbnailDataUrl: 'data:image/gif;base64,R0lGODlh' }],
      [
        'miniatura con base64 inválido',
        { thumbnailDataUrl: `${PNG_DATA_URL}!!` },
      ],
      [
        'miniatura con basura después del padding',
        { thumbnailDataUrl: `${PNG_DATA_URL}AAAA` },
      ],
      [
        'miniatura que no es PNG aunque lo declare',
        { thumbnailDataUrl: `data:image/png;base64,${MINIMAL_JPEG_BASE64}` },
      ],
    ])('rechaza con 400: %s', async (_name, overrides) => {
      expect(await statusOf(() => service.create(dto(overrides), 7))).toBe(
        HttpStatus.BAD_REQUEST,
      );
      expect(prisma.mockupTemplate.create).not.toHaveBeenCalled();
    });

    it('rechaza con 413 una miniatura de más de 96KB decodificada (R6)', async () => {
      expect(MAX_MOCKUP_TEMPLATE_THUMBNAIL_BYTES).toBe(96 * 1024);
      const error = await service
        .create(
          dto({
            thumbnailDataUrl: `data:image/png;base64,${base64OfBytes(
              MAX_MOCKUP_TEMPLATE_THUMBNAIL_BYTES + 1,
            )}`,
          }),
          7,
        )
        .catch((e: HttpException) => e);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
      expect((error as HttpException).message).toBe(
        'La miniatura de la plantilla no puede superar 96KB',
      );
      expect(prisma.mockupTemplate.create).not.toHaveBeenCalled();
    });

    it('rechaza con 413 una config de más de 8MB', async () => {
      const big = 'A'.repeat(MAX_MOCKUP_TEMPLATE_CONFIG_BYTES);
      expect(
        await statusOf(() =>
          service.create(
            dto({
              config: config({
                layers: [{ dataUrl: `data:image/png;base64,${big}` }],
              }),
            }),
            7,
          ),
        ),
      ).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
      expect(prisma.mockupTemplate.create).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('cambia sólo el nombre (sin espacios de más) y devuelve el resumen', async () => {
      prisma.mockupTemplate.update.mockResolvedValue(
        summaryRow({ name: 'Nuevo nombre' }),
      );

      const result = await service.rename(4, { name: ' Nuevo nombre ' });

      const args = prisma.mockupTemplate.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 4 });
      expect(args.data).toEqual({ name: 'Nuevo nombre' });
      expect(args.select.config).toBeUndefined();
      expect(result).toEqual({ ...SUMMARY, name: 'Nuevo nombre' });
    });

    it('rechaza con 400 un nombre vacío o de más de 80', async () => {
      expect(await statusOf(() => service.rename(4, { name: '' }))).toBe(
        HttpStatus.BAD_REQUEST,
      );
      expect(
        await statusOf(() => service.rename(4, { name: 'x'.repeat(81) })),
      ).toBe(HttpStatus.BAD_REQUEST);
      expect(prisma.mockupTemplate.update).not.toHaveBeenCalled();
    });

    it('responde 404 si no existe (P2025)', async () => {
      prisma.mockupTemplate.update.mockRejectedValue({ code: 'P2025' });
      expect(await statusOf(() => service.rename(99, { name: 'x' }))).toBe(
        HttpStatus.NOT_FOUND,
      );
    });

    it('propaga otros errores de Prisma', async () => {
      const boom = new Error('db caída');
      prisma.mockupTemplate.update.mockRejectedValue(boom);
      await expect(service.rename(4, { name: 'x' })).rejects.toBe(boom);
    });
  });

  describe('remove', () => {
    it('borra la plantilla', async () => {
      await expect(service.remove(4)).resolves.toBeUndefined();
      expect(prisma.mockupTemplate.deleteMany).toHaveBeenCalledWith({
        where: { id: 4 },
      });
    });

    it('responde 404 si no borró nada', async () => {
      prisma.mockupTemplate.deleteMany.mockResolvedValue({ count: 0 });
      expect(await statusOf(() => service.remove(99))).toBe(
        HttpStatus.NOT_FOUND,
      );
    });
  });
});
