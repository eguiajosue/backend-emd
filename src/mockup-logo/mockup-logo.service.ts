import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { assertBase64FileValid } from 'src/common/file-validation';
import { MOCKUP_AUTHOR_SELECT, mockupAuthor } from 'src/common/mockup-author';
import { STORAGE_FOLDERS, StorageService } from 'src/storage/storage.service';
import {
  base64DecodedBytes,
  parseImageDataUrl,
  pngDimensions,
} from 'src/common/mockup-validation';
import {
  CreateMockupLogoDto,
  MAX_MOCKUP_LOGO_BYTES,
  MAX_MOCKUP_LOGO_THUMBNAIL_BYTES,
  MAX_MOCKUP_LOGO_THUMBNAIL_SIDE,
  MAX_MOCKUP_LOGO_NAME_LENGTH,
  MOCKUP_LOGO_MIME_TYPES,
  RenameMockupLogoDto,
} from './dto/mockup-logo.dto';

/** Fila de la pestaña "Logos" (frontend `MockupLogoSummary`). */
export interface MockupLogoSummary {
  id: number;
  name: string;
  useCount: number;
  /** ISO 8601, o null si nunca se usó. */
  lastUsedAt: string | null;
  /** ISO 8601. */
  createdAt: string;
  createdBy: { id: number; name: string } | null;
}

/**
 * Selección del listado: NUNCA `imageData` (hasta 2MB por logo) ni
 * `thumbnailData`. La miniatura se pide aparte por tarjeta visible
 * (`GET /mockup-logos/:id/thumbnail`) y la imagen completa al elegir el
 * logo (`GET /mockup-logos/:id/image`).
 */
export const MOCKUP_LOGO_SUMMARY_SELECT = {
  id: true,
  name: true,
  useCount: true,
  lastUsedAt: true,
  createdAt: true,
  createdBy: MOCKUP_AUTHOR_SELECT,
} satisfies Prisma.MockupLogoSelect;

/** "Más usados primero"; empate: usado más recientemente, luego más nuevo. */
export const MOCKUP_LOGO_ORDER_BY = [
  { useCount: 'desc' },
  { lastUsedAt: { sort: 'desc', nulls: 'last' } },
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.MockupLogoOrderByWithRelationInput[];

type MockupLogoSummaryRow = Prisma.MockupLogoGetPayload<{
  select: typeof MOCKUP_LOGO_SUMMARY_SELECT;
}>;

const MAX_LOGO_MB = MAX_MOCKUP_LOGO_BYTES / (1024 * 1024);
const MAX_THUMBNAIL_KB = MAX_MOCKUP_LOGO_THUMBNAIL_BYTES / 1024;

/**
 * Biblioteca de logos del creador de mockups, compartida por la empresa
 * (`/mockup-logos`). Los roles que pueden usarla los fija el controller.
 */
@Injectable()
export class MockupLogoService {
  constructor(
    private readonly prisma: PrismaService,
    // Default sólo para los tests que construyen el service a mano: en la app
    // lo inyecta siempre StorageModule (global).
    private readonly storage: StorageService = StorageService.database(),
  ) {}

  /** Todos los logos, más usados primero, sin la imagen. */
  async findAll(): Promise<MockupLogoSummary[]> {
    const rows = await this.prisma.mockupLogo.findMany({
      select: MOCKUP_LOGO_SUMMARY_SELECT,
      orderBy: MOCKUP_LOGO_ORDER_BY,
    });
    return rows.map((row) => this.toSummary(row));
  }

  /** La imagen completa de un logo como data URL (404 si no existe). */
  async findImage(id: number): Promise<{ dataUrl: string }> {
    const row = await this.prisma.mockupLogo.findUnique({
      where: { id },
      select: { imageData: true, imageKey: true, imageMime: true },
    });
    if (!row) throw notFound();
    return {
      dataUrl: await this.storage.toDataUrl(row.imageMime, {
        data: row.imageData,
        key: row.imageKey,
      }),
    };
  }

  /** La miniatura (≤ 160px) de un logo como data URL (404 si no existe). */
  async findThumbnail(id: number): Promise<{ dataUrl: string }> {
    const row = await this.prisma.mockupLogo.findUnique({
      where: { id },
      select: { thumbnailData: true, thumbnailKey: true, thumbnailMime: true },
    });
    if (!row) throw notFound();
    return {
      dataUrl: await this.storage.toDataUrl(row.thumbnailMime, {
        data: row.thumbnailData,
        key: row.thumbnailKey,
      }),
    };
  }

  /** Sube un logo. Devuelve la fila tal como sale en el listado. */
  async create(
    dto: CreateMockupLogoDto,
    userId: number,
  ): Promise<MockupLogoSummary> {
    // Repite la validación del DTO: el service también se usa sin el pipe.
    const name = assertName(dto.name);
    const image = await assertImageValid(dto.imageDataUrl);
    const thumbnail = await assertThumbnailValid(dto.thumbnailDataUrl);
    const imageBlob = await this.storage.saveBase64(
      STORAGE_FOLDERS.mockupLogoImage,
      image.base64,
      image.mime,
    );
    const thumbnailBlob = await this.storage
      .saveBase64(
        STORAGE_FOLDERS.mockupLogoThumbnail,
        thumbnail.base64,
        thumbnail.mime,
      )
      .catch(async (error) => {
        await this.storage.deleteQuietly([imageBlob.key]);
        throw error;
      });
    const row = await this.prisma.mockupLogo
      .create({
        data: {
          name,
          imageData: imageBlob.data,
          imageKey: imageBlob.key,
          imageMime: image.mime,
          thumbnailData: thumbnailBlob.data,
          thumbnailKey: thumbnailBlob.key,
          thumbnailMime: thumbnail.mime,
          createdById: userId,
        },
        select: MOCKUP_LOGO_SUMMARY_SELECT,
      })
      .catch(async (error) => {
        await this.storage.deleteQuietly([imageBlob.key, thumbnailBlob.key]);
        throw error;
      });
    return this.toSummary(row);
  }

  /** Renombra un logo (404 si no existe). */
  async rename(
    id: number,
    dto: RenameMockupLogoDto,
  ): Promise<MockupLogoSummary> {
    const name = assertName(dto.name);
    try {
      const row = await this.prisma.mockupLogo.update({
        where: { id },
        data: { name },
        select: MOCKUP_LOGO_SUMMARY_SELECT,
      });
      return this.toSummary(row);
    } catch (error) {
      if (error?.code === 'P2025') throw notFound();
      throw error;
    }
  }

  /**
   * Registra que se agregó el logo a un mockup: suma 1 a `useCount` (en la
   * base, atómico ante usos simultáneos) y marca `lastUsedAt`.
   */
  async markUsed(id: number): Promise<void> {
    const { count } = await this.prisma.mockupLogo.updateMany({
      where: { id },
      data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
    });
    if (count === 0) throw notFound();
  }

  /** Borra un logo (404 si no existe). */
  async remove(id: number): Promise<void> {
    // Las claves se leen antes de borrar la fila; los objetos se borran
    // después, a mejor esfuerzo.
    const existing = await this.prisma.mockupLogo.findUnique({
      where: { id },
      select: { imageKey: true, thumbnailKey: true },
    });
    const { count } = await this.prisma.mockupLogo.deleteMany({
      where: { id },
    });
    if (count === 0) throw notFound();
    await this.storage.deleteQuietly([
      existing?.imageKey,
      existing?.thumbnailKey,
    ]);
  }

  private toSummary(row: MockupLogoSummaryRow): MockupLogoSummary {
    return {
      id: row.id,
      name: row.name,
      useCount: row.useCount,
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      createdBy: mockupAuthor(row.createdBy),
    };
  }
}

function notFound() {
  return new HttpException('Logo no encontrado', HttpStatus.NOT_FOUND);
}

function assertName(name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || trimmed.length > MAX_MOCKUP_LOGO_NAME_LENGTH) {
    throw new HttpException(
      `El nombre del logo es obligatorio (máx. ${MAX_MOCKUP_LOGO_NAME_LENGTH} caracteres)`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return trimmed;
}

/**
 * Logo: data URL PNG con base64 estricto (400), ≤ 2MB decodificado (413) y
 * PNG REAL por magic bytes (400).
 */
async function assertImageValid(
  imageDataUrl: unknown,
): Promise<{ base64: string; mime: string }> {
  const { base64, mime } = parseImageDataUrl(imageDataUrl, {
    allowedMimeTypes: MOCKUP_LOGO_MIME_TYPES,
    subject: 'El logo',
    formats: 'PNG',
  });
  const sizeMessage = `El logo no puede superar ${MAX_LOGO_MB}MB`;
  if (base64DecodedBytes(base64) > MAX_MOCKUP_LOGO_BYTES) {
    throw new HttpException(sizeMessage, HttpStatus.PAYLOAD_TOO_LARGE);
  }
  await assertBase64FileValid(
    { data: base64, filename: 'logo', mimeType: mime },
    {
      maxBytes: MAX_MOCKUP_LOGO_BYTES,
      allowedMimeTypes: MOCKUP_LOGO_MIME_TYPES,
      sizeErrorMessage: sizeMessage,
      typeErrorMessage: 'El contenido del logo no es un PNG válido',
    },
  );
  return { base64, mime };
}

/**
 * Miniatura del logo: data URL PNG con base64 estricto (400), ≤ 24KB
 * decodificada (413), PNG REAL por magic bytes (400) y ≤ 160px de lado
 * según su IHDR (400).
 */
async function assertThumbnailValid(
  thumbnailDataUrl: unknown,
): Promise<{ base64: string; mime: string }> {
  const { base64, mime } = parseImageDataUrl(thumbnailDataUrl, {
    allowedMimeTypes: MOCKUP_LOGO_MIME_TYPES,
    subject: 'La miniatura del logo',
    formats: 'PNG',
  });
  const sizeMessage = `La miniatura del logo no puede superar ${MAX_THUMBNAIL_KB}KB`;
  if (base64DecodedBytes(base64) > MAX_MOCKUP_LOGO_THUMBNAIL_BYTES) {
    throw new HttpException(sizeMessage, HttpStatus.PAYLOAD_TOO_LARGE);
  }
  const png = await assertBase64FileValid(
    { data: base64, filename: 'miniatura', mimeType: mime },
    {
      maxBytes: MAX_MOCKUP_LOGO_THUMBNAIL_BYTES,
      allowedMimeTypes: MOCKUP_LOGO_MIME_TYPES,
      sizeErrorMessage: sizeMessage,
      typeErrorMessage:
        'El contenido de la miniatura del logo no es un PNG válido',
    },
  );
  const size = pngDimensions(png);
  if (
    !size ||
    size.width > MAX_MOCKUP_LOGO_THUMBNAIL_SIDE ||
    size.height > MAX_MOCKUP_LOGO_THUMBNAIL_SIDE
  ) {
    throw new HttpException(
      `La miniatura del logo no puede superar ${MAX_MOCKUP_LOGO_THUMBNAIL_SIDE}px de lado`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return { base64, mime };
}
