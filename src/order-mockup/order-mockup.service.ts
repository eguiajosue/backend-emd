import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { assertBase64FileValid } from 'src/common/file-validation';
import { OrderService, RequestingUser } from 'src/order/order.service';
import {
  CreateOrderMockupDto,
  MAX_MOCKUP_BYTES,
  MOCKUP_GARMENTS,
  MOCKUP_IMAGE_MIME_TYPES,
  MockupGarment,
} from './dto/create-order-mockup.dto';

/** Fila del listado (frontend `OrderMockupSummary`). */
export interface OrderMockupSummary {
  id: number;
  orderId: number;
  garment: MockupGarment;
  /** ISO 8601. */
  createdAt: string;
  createdBy: { id: number; name: string } | null;
}

/** Mockup completo (frontend `OrderMockupDetail`). */
export interface OrderMockupDetail extends OrderMockupSummary {
  /** `data:image/png;base64,...` (o image/jpeg). */
  dataUrl: string;
  config: Prisma.JsonValue;
}

/**
 * Selección del listado: NUNCA `imageData` ni `config` (cada fila puede
 * pesar varios MB; ver plan mockups-3d, sección 4). El autor sólo con los
 * campos necesarios para mostrar su nombre, sin password ni roles.
 */
export const MOCKUP_SUMMARY_SELECT = {
  id: true,
  orderId: true,
  garment: true,
  createdAt: true,
  createdBy: {
    select: { id: true, firstName: true, lastName: true, username: true },
  },
} satisfies Prisma.OrderMockupSelect;

/** Detalle: lo del listado más la lámina y la configuración del estudio. */
const MOCKUP_DETAIL_SELECT = {
  ...MOCKUP_SUMMARY_SELECT,
  imageData: true,
  imageMime: true,
  config: true,
} satisfies Prisma.OrderMockupSelect;

type MockupSummaryRow = Prisma.OrderMockupGetPayload<{
  select: typeof MOCKUP_SUMMARY_SELECT;
}>;

/** `data:<mime>;base64,` al principio del data URL. */
const DATA_URL_PREFIX = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,/i;

/** Prefijo obligatorio de cada diseño embebido en `config.layers[].dataUrl`. */
const LAYER_DATA_URL_PREFIX = 'data:image/png;base64,';

const MAX_MOCKUP_MB = MAX_MOCKUP_BYTES / (1024 * 1024);

/**
 * Mockups 3D adjuntados a un pedido (`/orders/:id/mockups`). La visibilidad
 * es la misma que la del pedido: todo pasa por
 * `OrderService.assertOrderAccess` (404 si no existe, 403 si el área/rol no
 * lo ve). Los roles que pueden escribir los fija el controller.
 */
@Injectable()
export class OrderMockupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
  ) {}

  /** Mockups del pedido, más nuevos primero, sin imagen ni configuración. */
  async findAll(
    orderId: number,
    requestingUser: RequestingUser,
  ): Promise<OrderMockupSummary[]> {
    await this.orderService.assertOrderAccess(orderId, requestingUser);
    const rows = await this.prisma.orderMockup.findMany({
      where: { orderId },
      select: MOCKUP_SUMMARY_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map((row) => this.toSummary(row));
  }

  /** Un mockup con su lámina como data URL y la configuración del estudio. */
  async findOne(
    orderId: number,
    mockupId: number,
    requestingUser: RequestingUser,
  ): Promise<OrderMockupDetail> {
    await this.orderService.assertOrderAccess(orderId, requestingUser);
    // Filtrar también por `orderId`: un id de mockup de OTRO pedido (al que
    // quizá el usuario no tiene acceso) responde 404, nunca su contenido.
    const row = await this.prisma.orderMockup.findFirst({
      where: { id: mockupId, orderId },
      select: MOCKUP_DETAIL_SELECT,
    });
    if (!row) {
      throw new HttpException('Mockup no encontrado', HttpStatus.NOT_FOUND);
    }
    return {
      ...this.toSummary(row),
      dataUrl: `data:${row.imageMime};base64,${row.imageData}`,
      config: row.config,
    };
  }

  /** Adjunta un mockup al pedido. Devuelve la fila tal como sale en el listado. */
  async create(
    orderId: number,
    dto: CreateOrderMockupDto,
    requestingUser: RequestingUser,
  ): Promise<OrderMockupSummary> {
    await this.orderService.assertOrderAccess(orderId, requestingUser);

    const garment = this.assertGarment(dto.garment);
    const image = await this.assertImageValid(dto.imageDataUrl, dto.config);
    this.assertConfigValid(dto.config, garment);

    const row = await this.prisma.orderMockup.create({
      data: {
        orderId,
        garment,
        imageData: image.base64,
        imageMime: image.mime,
        config: dto.config as Prisma.InputJsonObject,
        createdById: requestingUser.userId,
      },
      select: MOCKUP_SUMMARY_SELECT,
    });
    return this.toSummary(row);
  }

  /** Borra un mockup del pedido (404 si no existe o es de otro pedido). */
  async remove(
    orderId: number,
    mockupId: number,
    requestingUser: RequestingUser,
  ): Promise<void> {
    await this.orderService.assertOrderAccess(orderId, requestingUser);
    const { count } = await this.prisma.orderMockup.deleteMany({
      where: { id: mockupId, orderId },
    });
    if (count === 0) {
      throw new HttpException('Mockup no encontrado', HttpStatus.NOT_FOUND);
    }
  }

  private toSummary(row: MockupSummaryRow): OrderMockupSummary {
    const createdBy = row.createdBy
      ? {
          id: row.createdBy.id,
          // Mismo criterio que `OrderService.userDisplayName`: nombre y
          // apellido, o el username si no tiene nombre cargado.
          name:
            [row.createdBy.firstName, row.createdBy.lastName]
              .filter(Boolean)
              .join(' ') || row.createdBy.username,
        }
      : null;
    return {
      id: row.id,
      orderId: row.orderId,
      garment: row.garment as MockupGarment,
      createdAt: row.createdAt.toISOString(),
      createdBy,
    };
  }

  /** Repite la validación del DTO: el service también se usa sin el pipe. */
  private assertGarment(garment: unknown): MockupGarment {
    if (!MOCKUP_GARMENTS.includes(garment as MockupGarment)) {
      throw new HttpException(
        'La prenda del mockup debe ser playera (tshirt) o gorra (cap)',
        HttpStatus.BAD_REQUEST,
      );
    }
    return garment as MockupGarment;
  }

  /**
   * Valida la lámina: data URL PNG/JPEG (400), topes de 8MB de la imagen,
   * de la configuración y de ambas juntas (413, decisión R1), y tipo REAL por
   * magic bytes (400, mismo helper que los archivos del pedido).
   */
  private async assertImageValid(
    imageDataUrl: unknown,
    config: unknown,
  ): Promise<{ base64: string; mime: string }> {
    const match =
      typeof imageDataUrl === 'string'
        ? DATA_URL_PREFIX.exec(imageDataUrl)
        : null;
    if (!match) {
      throw new HttpException(
        'La imagen del mockup debe ser un data URL en base64 (PNG o JPEG)',
        HttpStatus.BAD_REQUEST,
      );
    }
    const dataUrl = imageDataUrl as string;
    const mime = match[1].toLowerCase();
    if (!(MOCKUP_IMAGE_MIME_TYPES as readonly string[]).includes(mime)) {
      throw new HttpException(
        'La imagen del mockup debe ser PNG o JPEG',
        HttpStatus.BAD_REQUEST,
      );
    }
    const base64 = dataUrl.slice(match[0].length);

    // Tamaños antes de decodificar nada: se calculan sobre los strings.
    if (base64DecodedBytes(base64) > MAX_MOCKUP_BYTES) {
      throw new HttpException(
        `La imagen del mockup no puede superar ${MAX_MOCKUP_MB}MB`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    const configBytes = Buffer.byteLength(JSON.stringify(config ?? null));
    if (configBytes > MAX_MOCKUP_BYTES) {
      throw new HttpException(
        `Los diseños del mockup no pueden superar ${MAX_MOCKUP_MB}MB; usa imágenes más livianas o menos diseños`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    if (Buffer.byteLength(dataUrl) + configBytes > MAX_MOCKUP_BYTES) {
      throw new HttpException(
        `El mockup (imagen más diseños) no puede superar ${MAX_MOCKUP_MB}MB; usa imágenes más livianas o menos diseños`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    await assertBase64FileValid(
      { data: base64, filename: 'mockup', mimeType: mime },
      {
        maxBytes: MAX_MOCKUP_BYTES,
        allowedMimeTypes: MOCKUP_IMAGE_MIME_TYPES,
        sizeErrorMessage: `La imagen del mockup no puede superar ${MAX_MOCKUP_MB}MB`,
        typeErrorMessage:
          'El contenido de la imagen del mockup no es un PNG o JPEG válido',
      },
    );
    return { base64, mime };
  }

  /**
   * Validación liviana de `MockupConfig`: lo justo para que el estudio pueda
   * volver a abrirlo. Prenda igual a la del mockup, `colors` objeto,
   * `layers` array de objetos y cada `dataUrl` de diseño, si viene, un PNG.
   */
  private assertConfigValid(config: unknown, garment: MockupGarment) {
    const invalid = (message: string) =>
      new HttpException(message, HttpStatus.BAD_REQUEST);

    if (!isPlainObject(config)) {
      throw invalid('La configuración del mockup es obligatoria');
    }
    if (config.garment !== garment) {
      throw invalid('La configuración no corresponde a la prenda del mockup');
    }
    if (!isPlainObject(config.colors)) {
      throw invalid('La configuración del mockup no tiene colores');
    }
    if (!Array.isArray(config.layers)) {
      throw invalid('La configuración del mockup no tiene la lista de diseños');
    }
    for (const layer of config.layers) {
      if (!isPlainObject(layer)) {
        throw invalid('Cada diseño del mockup debe ser un objeto');
      }
      if (
        layer.dataUrl !== undefined &&
        (typeof layer.dataUrl !== 'string' ||
          !layer.dataUrl.startsWith(LAYER_DATA_URL_PREFIX))
      ) {
        throw invalid('Cada diseño del mockup debe ser una imagen PNG');
      }
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Bytes que ocupa un string base64 ya decodificado, sin decodificarlo. */
function base64DecodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
