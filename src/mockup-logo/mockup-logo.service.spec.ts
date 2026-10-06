import { HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateMockupLogoDto,
  MAX_MOCKUP_LOGO_BYTES,
  MAX_MOCKUP_LOGO_THUMBNAIL_BYTES,
} from './dto/mockup-logo.dto';
import { MockupLogoService } from './mockup-logo.service';

// PNG mínimo válido (mismo que order-mockup.service.spec.ts).
const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_DATA_URL = `data:image/png;base64,${MINIMAL_PNG_BASE64}`;
/** El PNG mínimo (1×1) con otro ancho/alto en su IHDR. */
const pngOfSize = (width: number, height: number) => {
  const png = Buffer.from(MINIMAL_PNG_BASE64, 'base64');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return `data:image/png;base64,${png.toString('base64')}`;
};
const MINIMAL_JPEG_BASE64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]).toString('base64');

const CREATED_AT = new Date('2026-10-05T12:00:00.000Z');
const USED_AT = new Date('2026-10-05T15:30:00.000Z');

const dto = (
  overrides: Partial<Record<keyof CreateMockupLogoDto, unknown>> = {},
): CreateMockupLogoDto =>
  ({
    name: 'Logo Acme',
    imageDataUrl: PNG_DATA_URL,
    thumbnailDataUrl: PNG_DATA_URL,
    ...overrides,
  }) as CreateMockupLogoDto;

const summaryRow = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  name: 'Logo Acme',
  useCount: 0,
  lastUsedAt: null,
  createdAt: CREATED_AT,
  createdBy: { id: 7, firstName: 'Ana', lastName: 'Ruiz', username: 'ana' },
  ...overrides,
});

const SUMMARY = {
  id: 5,
  name: 'Logo Acme',
  useCount: 0,
  lastUsedAt: null,
  createdAt: '2026-10-05T12:00:00.000Z',
  createdBy: { id: 7, name: 'Ana Ruiz' },
};

const base64OfBytes = (bytes: number) =>
  Buffer.alloc(bytes, 0).toString('base64');

describe('MockupLogoService', () => {
  let service: MockupLogoService;
  let prisma: {
    mockupLogo: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      mockupLogo: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(summaryRow()),
        update: jest.fn().mockResolvedValue(summaryRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new MockupLogoService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

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
    it('lista sin la imagen, más usados primero (empate: usado más reciente, nunca usados al final, luego más nuevos)', async () => {
      prisma.mockupLogo.findMany.mockResolvedValue([
        summaryRow({ id: 2, useCount: 3, lastUsedAt: USED_AT }),
        summaryRow({ createdBy: null }),
      ]);

      const result = await service.findAll();

      const args = prisma.mockupLogo.findMany.mock.calls[0][0];
      expect(args.select.imageData).toBeUndefined();
      expect(args.select.imageMime).toBeUndefined();
      expect(args.select.thumbnailData).toBeUndefined();
      expect(args.select.thumbnailMime).toBeUndefined();
      expect(args.orderBy).toEqual([
        { useCount: 'desc' },
        { lastUsedAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ]);
      expect(result).toEqual([
        {
          ...SUMMARY,
          id: 2,
          useCount: 3,
          lastUsedAt: '2026-10-05T15:30:00.000Z',
        },
        { ...SUMMARY, createdBy: null },
      ]);
    });
  });

  describe('findImage', () => {
    it('devuelve la imagen como data URL', async () => {
      prisma.mockupLogo.findUnique.mockResolvedValue({
        imageData: MINIMAL_PNG_BASE64,
        imageMime: 'image/png',
      });

      await expect(service.findImage(5)).resolves.toEqual({
        dataUrl: PNG_DATA_URL,
      });
      expect(prisma.mockupLogo.findUnique).toHaveBeenCalledWith({
        where: { id: 5 },
        select: { imageData: true, imageKey: true, imageMime: true },
      });
    });

    it('responde 404 si no existe', async () => {
      expect(await statusOf(() => service.findImage(99))).toBe(
        HttpStatus.NOT_FOUND,
      );
    });
  });

  describe('findThumbnail', () => {
    it('devuelve la miniatura como data URL, sin leer la imagen completa', async () => {
      prisma.mockupLogo.findUnique.mockResolvedValue({
        thumbnailData: MINIMAL_PNG_BASE64,
        thumbnailMime: 'image/png',
      });

      await expect(service.findThumbnail(5)).resolves.toEqual({
        dataUrl: PNG_DATA_URL,
      });
      expect(prisma.mockupLogo.findUnique).toHaveBeenCalledWith({
        where: { id: 5 },
        select: {
          thumbnailData: true,
          thumbnailKey: true,
          thumbnailMime: true,
        },
      });
    });

    it('responde 404 si no existe', async () => {
      expect(await statusOf(() => service.findThumbnail(99))).toBe(
        HttpStatus.NOT_FOUND,
      );
    });
  });

  describe('create', () => {
    it('guarda nombre (sin espacios de más), imagen y miniatura sin prefijo, mimes y autor; responde sin imágenes', async () => {
      const thumbnailDataUrl = pngOfSize(160, 120);
      const result = await service.create(
        dto({ name: ' Logo Acme ', thumbnailDataUrl }),
        7,
      );

      const args = prisma.mockupLogo.create.mock.calls[0][0];
      expect(args.data).toEqual({
        name: 'Logo Acme',
        imageData: MINIMAL_PNG_BASE64,
        // Driver `db` (default): el base64 en la columna, sin clave.
        imageKey: null,
        imageMime: 'image/png',
        thumbnailData: thumbnailDataUrl.slice('data:image/png;base64,'.length),
        thumbnailKey: null,
        thumbnailMime: 'image/png',
        createdById: 7,
      });
      expect(args.select.imageData).toBeUndefined();
      expect(args.select.thumbnailData).toBeUndefined();
      expect(result).toEqual(SUMMARY);
    });

    it.each<[string, Partial<Record<keyof CreateMockupLogoDto, unknown>>]>([
      ['nombre vacío', { name: '' }],
      ['nombre de más de 80 caracteres', { name: 'x'.repeat(81) }],
      ['imagen que no es data URL', { imageDataUrl: MINIMAL_PNG_BASE64 }],
      [
        'imagen JPEG',
        { imageDataUrl: `data:image/jpeg;base64,${MINIMAL_JPEG_BASE64}` },
      ],
      ['imagen SVG', { imageDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }],
      ['base64 inválido', { imageDataUrl: 'data:image/png;base64,iVBO*' }],
      ['basura después del padding', { imageDataUrl: `${PNG_DATA_URL}AAAA` }],
      [
        'contenido que no es PNG aunque lo declare',
        { imageDataUrl: `data:image/png;base64,${MINIMAL_JPEG_BASE64}` },
      ],
      ['sin miniatura', { thumbnailDataUrl: undefined }],
      [
        'miniatura JPEG',
        { thumbnailDataUrl: `data:image/jpeg;base64,${MINIMAL_JPEG_BASE64}` },
      ],
      [
        'miniatura con base64 inválido',
        { thumbnailDataUrl: `${PNG_DATA_URL}!` },
      ],
      [
        'miniatura que no es PNG aunque lo declare',
        { thumbnailDataUrl: `data:image/png;base64,${MINIMAL_JPEG_BASE64}` },
      ],
      [
        'miniatura de más de 160px de ancho',
        { thumbnailDataUrl: pngOfSize(161, 10) },
      ],
      [
        'miniatura de más de 160px de alto',
        { thumbnailDataUrl: pngOfSize(10, 161) },
      ],
    ])('rechaza con 400: %s', async (_name, overrides) => {
      expect(await statusOf(() => service.create(dto(overrides), 7))).toBe(
        HttpStatus.BAD_REQUEST,
      );
      expect(prisma.mockupLogo.create).not.toHaveBeenCalled();
    });

    it('rechaza con 413 un logo de más de 2MB decodificado', async () => {
      const error = await service
        .create(
          dto({
            imageDataUrl: `data:image/png;base64,${base64OfBytes(
              MAX_MOCKUP_LOGO_BYTES + 1,
            )}`,
          }),
          7,
        )
        .catch((e: HttpException) => e);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
      expect((error as HttpException).message).toBe(
        'El logo no puede superar 2MB',
      );
      expect(prisma.mockupLogo.create).not.toHaveBeenCalled();
    });

    it('rechaza con 413 una miniatura de más de 24KB decodificada', async () => {
      expect(MAX_MOCKUP_LOGO_THUMBNAIL_BYTES).toBe(24 * 1024);
      const error = await service
        .create(
          dto({
            thumbnailDataUrl: `data:image/png;base64,${base64OfBytes(
              MAX_MOCKUP_LOGO_THUMBNAIL_BYTES + 1,
            )}`,
          }),
          7,
        )
        .catch((e: HttpException) => e);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
      expect((error as HttpException).message).toBe(
        'La miniatura del logo no puede superar 24KB',
      );
      expect(prisma.mockupLogo.create).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('cambia sólo el nombre y devuelve el resumen', async () => {
      prisma.mockupLogo.update.mockResolvedValue(
        summaryRow({ name: 'Acme 2026' }),
      );

      const result = await service.rename(5, { name: 'Acme 2026 ' });

      const args = prisma.mockupLogo.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 5 });
      expect(args.data).toEqual({ name: 'Acme 2026' });
      expect(args.select.imageData).toBeUndefined();
      expect(result).toEqual({ ...SUMMARY, name: 'Acme 2026' });
    });

    it('rechaza con 400 un nombre vacío', async () => {
      expect(await statusOf(() => service.rename(5, { name: '  ' }))).toBe(
        HttpStatus.BAD_REQUEST,
      );
      expect(prisma.mockupLogo.update).not.toHaveBeenCalled();
    });

    it('responde 404 si no existe (P2025)', async () => {
      prisma.mockupLogo.update.mockRejectedValue({ code: 'P2025' });
      expect(await statusOf(() => service.rename(99, { name: 'x' }))).toBe(
        HttpStatus.NOT_FOUND,
      );
    });
  });

  describe('markUsed', () => {
    it('suma 1 al contador en la base y marca la fecha de uso', async () => {
      jest.useFakeTimers().setSystemTime(USED_AT);

      await expect(service.markUsed(5)).resolves.toBeUndefined();

      expect(prisma.mockupLogo.updateMany).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { useCount: { increment: 1 }, lastUsedAt: USED_AT },
      });
    });

    it('responde 404 si no existe', async () => {
      prisma.mockupLogo.updateMany.mockResolvedValue({ count: 0 });
      expect(await statusOf(() => service.markUsed(99))).toBe(
        HttpStatus.NOT_FOUND,
      );
    });
  });

  describe('remove', () => {
    it('borra el logo', async () => {
      await expect(service.remove(5)).resolves.toBeUndefined();
      expect(prisma.mockupLogo.deleteMany).toHaveBeenCalledWith({
        where: { id: 5 },
      });
    });

    it('responde 404 si no borró nada', async () => {
      prisma.mockupLogo.deleteMany.mockResolvedValue({ count: 0 });
      expect(await statusOf(() => service.remove(99))).toBe(
        HttpStatus.NOT_FOUND,
      );
    });
  });
});
