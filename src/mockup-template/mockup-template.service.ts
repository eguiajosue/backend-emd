import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { assertBase64FileValid } from 'src/common/file-validation';
import { MOCKUP_AUTHOR_SELECT, mockupAuthor } from 'src/common/mockup-author';
import {
  MOCKUP_GARMENT_MESSAGE,
  MockupGarment,
  isMockupGarment,
} from 'src/common/mockup-garments';
import {
  assertJsonHasNoNul,
  assertMockupConfigShape,
  base64DecodedBytes,
  parseImageDataUrl,
} from 'src/common/mockup-validation';
import {
  CreateMockupTemplateDto,
  MAX_MOCKUP_TEMPLATE_CONFIG_BYTES,
  MAX_MOCKUP_TEMPLATE_NAME_LENGTH,
  MAX_MOCKUP_TEMPLATE_THUMBNAIL_BYTES,
  MOCKUP_TEMPLATE_THUMBNAIL_MIME_TYPES,
  RenameMockupTemplateDto,
} from './dto/mockup-template.dto';

/** Fila del panel "Plantillas" (frontend `MockupTemplateSummary`). */
export interface MockupTemplateSummary {
  id: number;
  name: string;
  garment: MockupGarment;
  /** `data:image/png;base64,...` (o image/jpeg), máx. 96KB. */
  thumbnailUrl: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
  createdBy: { id: number; name: string } | null;
}

/** Plantilla completa, para aplicarla en el estudio. */
export interface MockupTemplateDetail extends MockupTemplateSummary {
  config: Prisma.JsonValue;
}

/**
 * Selección del listado: todo menos `config` (puede pesar varios MB). La
 * miniatura sí viene: está topada a 96KB para que el panel no tenga que
 * pedir cada plantilla aparte.
 */
export const MOCKUP_TEMPLATE_SUMMARY_SELECT = {
  id: true,
  name: true,
  garment: true,
  thumbnailData: true,
  thumbnailMime: true,
  createdAt: true,
  updatedAt: true,
  createdBy: MOCKUP_AUTHOR_SELECT,
} satisfies Prisma.MockupTemplateSelect;

const MOCKUP_TEMPLATE_DETAIL_SELECT = {
  ...MOCKUP_TEMPLATE_SUMMARY_SELECT,
  config: true,
} satisfies Prisma.MockupTemplateSelect;

type MockupTemplateSummaryRow = Prisma.MockupTemplateGetPayload<{
  select: typeof MOCKUP_TEMPLATE_SUMMARY_SELECT;
}>;

const MAX_THUMBNAIL_KB = MAX_MOCKUP_TEMPLATE_THUMBNAIL_BYTES / 1024;
const MAX_CONFIG_MB = MAX_MOCKUP_TEMPLATE_CONFIG_BYTES / (1024 * 1024);

/**
 * Plantillas del creador de mockups, compartidas por toda la empresa
 * (`/mockup-templates`). Los roles que pueden usarlas los fija el
 * controller.
 */
@Injectable()
export class MockupTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  /** Todas las plantillas, más nuevas primero, con miniatura y sin config. */
  async findAll(): Promise<MockupTemplateSummary[]> {
    const rows = await this.prisma.mockupTemplate.findMany({
      select: MOCKUP_TEMPLATE_SUMMARY_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map((row) => this.toSummary(row));
  }

  /** Una plantilla con su configuración completa (404 si no existe). */
  async findOne(id: number): Promise<MockupTemplateDetail> {
    const row = await this.prisma.mockupTemplate.findUnique({
      where: { id },
      select: MOCKUP_TEMPLATE_DETAIL_SELECT,
    });
    if (!row) throw notFound();
    return { ...this.toSummary(row), config: row.config };
  }

  /** Guarda una plantilla nueva. Devuelve la fila tal como sale en el listado. */
  async create(
    dto: CreateMockupTemplateDto,
    userId: number,
  ): Promise<MockupTemplateSummary> {
    // Repite la validación del DTO: el service también se usa sin el pipe.
    const name = assertName(dto.name);
    const garment = assertGarment(dto.garment);
    assertMockupConfigShape(dto.config, garment, 'de la plantilla');
    assertConfigSize(dto.config);
    const thumbnail = await assertThumbnailValid(dto.thumbnailDataUrl);

    const row = await this.prisma.mockupTemplate.create({
      data: {
        name,
        garment,
        config: dto.config as Prisma.InputJsonObject,
        thumbnailData: thumbnail.base64,
        thumbnailMime: thumbnail.mime,
        createdById: userId,
      },
      select: MOCKUP_TEMPLATE_SUMMARY_SELECT,
    });
    return this.toSummary(row);
  }

  /** Renombra una plantilla (404 si no existe). */
  async rename(
    id: number,
    dto: RenameMockupTemplateDto,
  ): Promise<MockupTemplateSummary> {
    const name = assertName(dto.name);
    try {
      const row = await this.prisma.mockupTemplate.update({
        where: { id },
        data: { name },
        select: MOCKUP_TEMPLATE_SUMMARY_SELECT,
      });
      return this.toSummary(row);
    } catch (error) {
      if (error?.code === 'P2025') throw notFound();
      throw error;
    }
  }

  /** Borra una plantilla (404 si no existe). */
  async remove(id: number): Promise<void> {
    const { count } = await this.prisma.mockupTemplate.deleteMany({
      where: { id },
    });
    if (count === 0) throw notFound();
  }

  private toSummary(row: MockupTemplateSummaryRow): MockupTemplateSummary {
    return {
      id: row.id,
      name: row.name,
      garment: row.garment as MockupGarment,
      thumbnailUrl: `data:${row.thumbnailMime};base64,${row.thumbnailData}`,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: mockupAuthor(row.createdBy),
    };
  }
}

function notFound() {
  return new HttpException('Plantilla no encontrada', HttpStatus.NOT_FOUND);
}

function assertName(name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || trimmed.length > MAX_MOCKUP_TEMPLATE_NAME_LENGTH) {
    throw new HttpException(
      `El nombre de la plantilla es obligatorio (máx. ${MAX_MOCKUP_TEMPLATE_NAME_LENGTH} caracteres)`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return trimmed;
}

function assertGarment(garment: unknown): MockupGarment {
  if (!isMockupGarment(garment)) {
    throw new HttpException(MOCKUP_GARMENT_MESSAGE, HttpStatus.BAD_REQUEST);
  }
  return garment;
}

/** Configuración ≤ 8MB serializada (413) y sin NUL (400, jsonb). */
function assertConfigSize(config: unknown) {
  const json = JSON.stringify(config);
  if (Buffer.byteLength(json) > MAX_MOCKUP_TEMPLATE_CONFIG_BYTES) {
    throw new HttpException(
      `Los diseños de la plantilla no pueden superar ${MAX_CONFIG_MB}MB; usa imágenes más livianas o menos diseños`,
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }
  assertJsonHasNoNul(
    json,
    'La configuración de la plantilla tiene caracteres inválidos',
  );
}

/**
 * Miniatura: data URL PNG/JPEG con base64 estricto (400), ≤ 96KB
 * decodificada (413) y tipo REAL por magic bytes (400).
 */
async function assertThumbnailValid(
  thumbnailDataUrl: unknown,
): Promise<{ base64: string; mime: string }> {
  const { base64, mime } = parseImageDataUrl(thumbnailDataUrl, {
    allowedMimeTypes: MOCKUP_TEMPLATE_THUMBNAIL_MIME_TYPES,
    subject: 'La miniatura de la plantilla',
    formats: 'PNG o JPEG',
  });
  const sizeMessage = `La miniatura de la plantilla no puede superar ${MAX_THUMBNAIL_KB}KB`;
  if (base64DecodedBytes(base64) > MAX_MOCKUP_TEMPLATE_THUMBNAIL_BYTES) {
    throw new HttpException(sizeMessage, HttpStatus.PAYLOAD_TOO_LARGE);
  }
  await assertBase64FileValid(
    { data: base64, filename: 'miniatura', mimeType: mime },
    {
      maxBytes: MAX_MOCKUP_TEMPLATE_THUMBNAIL_BYTES,
      allowedMimeTypes: MOCKUP_TEMPLATE_THUMBNAIL_MIME_TYPES,
      sizeErrorMessage: sizeMessage,
      typeErrorMessage:
        'El contenido de la miniatura de la plantilla no es un PNG o JPEG válido',
    },
  );
  return { base64, mime };
}
