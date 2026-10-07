import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  assertActiveBranchEmployee,
  BRANCH_BADGE_SELECT,
  branchOfUser,
} from 'src/branch/branch-access';
import { Role } from 'src/common/enums/roles.enum';
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
import { OrderService, RequestingUser } from 'src/order/order.service';
import { STORAGE_FOLDERS, StorageService } from 'src/storage/storage.service';
import {
  CreateOrderMockupDto,
  MAX_MOCKUP_BYTES,
  MOCKUP_IMAGE_MIME_TYPES,
} from './dto/create-order-mockup.dto';

/** Fila del listado (frontend `OrderMockupSummary`). */
export interface OrderMockupSummary {
  id: number;
  orderId: number;
  garment: MockupGarment;
  /** ISO 8601. */
  createdAt: string;
  createdBy: { id: number; name: string } | null;
  /** Empleado de la sucursal que lo armó (sólo mockups de sucursal). */
  branchEmployee?: { id: number; name: string };
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
  createdBy: MOCKUP_AUTHOR_SELECT,
  branchEmployee: BRANCH_BADGE_SELECT,
} satisfies Prisma.OrderMockupSelect;

/** Detalle: lo del listado más la lámina y la configuración del estudio. */
const MOCKUP_DETAIL_SELECT = {
  ...MOCKUP_SUMMARY_SELECT,
  imageData: true,
  imageKey: true,
  imageMime: true,
  config: true,
} satisfies Prisma.OrderMockupSelect;

type MockupSummaryRow = Prisma.OrderMockupGetPayload<{
  select: typeof MOCKUP_SUMMARY_SELECT;
}>;

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
    // Default sólo para los tests que construyen el service a mano: en la app
    // lo inyecta siempre StorageModule (global).
    private readonly storage: StorageService = StorageService.database(),
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
      // La lámina puede estar en la DB (legacy) o en el bucket.
      dataUrl: await this.storage.toDataUrl(row.imageMime, {
        data: row.imageData,
        key: row.imageKey,
      }),
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
    assertMockupConfigShape(dto.config, garment, 'del mockup');
    const branchEmployeeId = await this.resolveBranchEmployee(
      dto.branchEmployeeId,
      requestingUser,
    );

    const blob = await this.storage.saveBase64(
      STORAGE_FOLDERS.orderMockup,
      image.base64,
      image.mime,
    );
    const row = await this.prisma.orderMockup
      .create({
        data: {
          orderId,
          garment,
          imageData: blob.data,
          imageKey: blob.key,
          imageMime: image.mime,
          config: dto.config as Prisma.InputJsonObject,
          createdById: requestingUser.userId,
          ...(branchEmployeeId && { branchEmployeeId }),
        },
        select: MOCKUP_SUMMARY_SELECT,
      })
      .catch(async (error) => {
        await this.storage.deleteQuietly([blob.key]);
        throw error;
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
    // La clave del objeto se lee antes de borrar la fila; el objeto se borra
    // después, a mejor esfuerzo.
    const existing = await this.prisma.orderMockup.findFirst({
      where: { id: mockupId, orderId },
      select: { imageKey: true },
    });
    const { count } = await this.prisma.orderMockup.deleteMany({
      where: { id: mockupId, orderId },
    });
    if (count === 0) {
      throw new HttpException('Mockup no encontrado', HttpStatus.NOT_FOUND);
    }
    await this.storage.deleteQuietly([existing?.imageKey]);
  }

  private toSummary(row: MockupSummaryRow): OrderMockupSummary {
    return {
      id: row.id,
      orderId: row.orderId,
      garment: row.garment as MockupGarment,
      createdAt: row.createdAt.toISOString(),
      createdBy: mockupAuthor(row.createdBy),
      branchEmployee: row.branchEmployee ?? undefined,
    };
  }

  /**
   * Empleado de sucursal opcional: sólo cuenta desde la cuenta de sucursal y
   * tiene que ser de esa sucursal y estar activo. La matriz lo ignora.
   */
  private async resolveBranchEmployee(
    branchEmployeeId: number | undefined,
    requestingUser: RequestingUser,
  ): Promise<number | undefined> {
    if (!branchEmployeeId) return undefined;
    if (!requestingUser.roles?.includes(Role.SUCURSAL)) return undefined;
    const branch = await branchOfUser(this.prisma, requestingUser.userId);
    await assertActiveBranchEmployee(this.prisma, branch.id, branchEmployeeId);
    return branchEmployeeId;
  }

  /** Repite la validación del DTO: el service también se usa sin el pipe. */
  private assertGarment(garment: unknown): MockupGarment {
    if (!isMockupGarment(garment)) {
      throw new HttpException(MOCKUP_GARMENT_MESSAGE, HttpStatus.BAD_REQUEST);
    }
    return garment;
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
    const { base64, mime } = parseImageDataUrl(imageDataUrl, {
      allowedMimeTypes: MOCKUP_IMAGE_MIME_TYPES,
      subject: 'La imagen del mockup',
      formats: 'PNG o JPEG',
    });
    const dataUrl = imageDataUrl as string;

    // Tamaños antes de decodificar nada: se calculan sobre los strings.
    if (base64DecodedBytes(base64) > MAX_MOCKUP_BYTES) {
      throw new HttpException(
        `La imagen del mockup no puede superar ${MAX_MOCKUP_MB}MB`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    const configJson = JSON.stringify(config ?? null);
    const configBytes = Buffer.byteLength(configJson);
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
    assertJsonHasNoNul(
      configJson,
      'La configuración del mockup tiene caracteres inválidos',
    );

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
}
