import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { OrderProductionFile } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/storage/storage.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { Role } from 'src/common/enums/roles.enum';
import { OrderService, RequestingUser } from '../order.service';
import {
  CompleteProductionUploadDto,
  InitProductionUploadDto,
} from './production-file.dto';
import {
  MAX_PRODUCTION_FILE_BYTES,
  PRODUCTION_DOWNLOAD_URL_SECONDS,
  PRODUCTION_FILE_EXTENSIONS,
  PRODUCTION_FILE_STATUS as STATUS,
  PRODUCTION_PART_SIZE,
  PRODUCTION_UPLOAD_URL_SECONDS,
  STALE_UPLOAD_HOURS,
} from './production-file.constants';

/** Roles que suben/borran el archivo final: Diseño (y Recepción/admin como respaldo). */
export const PRODUCTION_FILE_WRITER_ROLES: Role[] = [
  Role.DISENO,
  Role.RECEPCION,
  Role.ADMIN,
  Role.SUPERUSER,
];

/** Nombre seguro para la clave del bucket (sin rutas ni caracteres raros). */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(-120);
  return cleaned || 'archivo';
}

export function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return match ? match[1].toLowerCase() : '';
}

@Injectable()
export class ProductionFileService {
  private readonly logger = new Logger(ProductionFileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly orders: OrderService,
    private readonly audit: AuditLogService,
  ) {}

  private requireBucket() {
    if (!this.storage.writesToObjectStorage) {
      throw new ServiceUnavailableException(
        'Los archivos de producción requieren almacenamiento en el bucket (STORAGE_DRIVER=s3)',
      );
    }
  }

  private partCountFor(sizeBytes: number): number {
    return Math.ceil(sizeBytes / PRODUCTION_PART_SIZE);
  }

  private async signParts(
    file: Pick<OrderProductionFile, 'objectKey' | 'uploadId'>,
    partNumbers: number[],
  ) {
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.storage.signUploadPart(
          file.objectKey,
          file.uploadId!,
          partNumber,
          PRODUCTION_UPLOAD_URL_SECONDS,
        ),
      })),
    );
  }

  private toView(file: OrderProductionFile) {
    return {
      id: file.id,
      orderId: file.orderId,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: Number(file.sizeBytes),
      status: file.status,
      version: file.version,
      notes: file.notes,
      uploadedById: file.uploadedById,
      createdAt: file.createdAt,
      completedAt: file.completedAt,
    };
  }

  /** Archivo de la subida en curso, validando pedido, dueño y estado. */
  private async loadUploading(
    orderId: number,
    fileId: number,
    user: RequestingUser,
  ): Promise<OrderProductionFile> {
    await this.orders.assertOrderAccess(orderId, user);
    const file = await this.prisma.orderProductionFile.findFirst({
      where: { id: fileId, orderId },
    });
    if (!file || file.status === STATUS.deleted) {
      throw new NotFoundException('Archivo no encontrado');
    }
    if (file.status !== STATUS.uploading || !file.uploadId) {
      throw new BadRequestException('La subida ya no está en curso');
    }
    this.assertOwnerOrAdmin(file, user);
    return file;
  }

  private assertOwnerOrAdmin(file: OrderProductionFile, user: RequestingUser) {
    const isAdmin = user.roles?.some(
      (r) => r === Role.ADMIN || r === Role.SUPERUSER,
    );
    if (file.uploadedById !== user.userId && !isAdmin) {
      throw new ForbiddenException('Sólo quien lo subió puede modificarlo');
    }
  }

  /** Abre la subida por partes y devuelve las URLs firmadas de cada parte. */
  async initUpload(
    orderId: number,
    dto: InitProductionUploadDto,
    user: RequestingUser,
  ) {
    this.requireBucket();
    await this.orders.assertOrderAccess(orderId, user);

    const ext = extensionOf(dto.fileName);
    if (!(PRODUCTION_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new BadRequestException(
        `Tipo de archivo no permitido. Usa: ${PRODUCTION_FILE_EXTENSIONS.join(', ')}`,
      );
    }
    if (dto.sizeBytes > MAX_PRODUCTION_FILE_BYTES) {
      throw new BadRequestException(
        `El archivo excede el máximo de ${Math.floor(MAX_PRODUCTION_FILE_BYTES / 1024 ** 3)} GB`,
      );
    }

    const objectKey = `orders/${orderId}/production/${randomUUID()}/${sanitizeFileName(dto.fileName)}`;
    const mimeType = dto.mimeType || 'application/octet-stream';
    const uploadId = await this.storage.createMultipartUpload(
      objectKey,
      mimeType,
    );

    let file: OrderProductionFile;
    try {
      const last = await this.prisma.orderProductionFile.aggregate({
        where: { orderId },
        _max: { version: true },
      });
      file = await this.prisma.orderProductionFile.create({
        data: {
          orderId,
          objectKey,
          fileName: dto.fileName.slice(0, 255),
          mimeType,
          sizeBytes: BigInt(dto.sizeBytes),
          status: STATUS.uploading,
          uploadId,
          version: (last._max.version ?? 0) + 1,
          notes: dto.notes?.trim() || null,
          uploadedById: user.userId,
        },
      });
    } catch (error) {
      await this.storage
        .abortMultipartUpload(objectKey, uploadId)
        .catch(() => undefined);
      throw error;
    }

    const partCount = this.partCountFor(dto.sizeBytes);
    const parts = await this.signParts(
      file,
      Array.from({ length: partCount }, (_, i) => i + 1),
    );
    return {
      fileId: file.id,
      partSize: PRODUCTION_PART_SIZE,
      partCount,
      parts,
    };
  }

  /** URLs nuevas para partes concretas (expiraron o hay que reintentar). */
  async signPartsFor(
    orderId: number,
    fileId: number,
    partNumbers: number[],
    user: RequestingUser,
  ) {
    const file = await this.loadUploading(orderId, fileId, user);
    const partCount = this.partCountFor(Number(file.sizeBytes));
    if (partNumbers.some((n) => n < 1 || n > partCount)) {
      throw new BadRequestException('Número de parte fuera de rango');
    }
    return { parts: await this.signParts(file, partNumbers) };
  }

  /** Cierra la subida, verifica el tamaño real y deja el archivo listo. */
  async completeUpload(
    orderId: number,
    fileId: number,
    dto: CompleteProductionUploadDto,
    user: RequestingUser,
  ) {
    const file = await this.loadUploading(orderId, fileId, user);
    const partCount = this.partCountFor(Number(file.sizeBytes));
    const numbers = new Set(dto.parts.map((p) => p.partNumber));
    if (
      dto.parts.length !== partCount ||
      numbers.size !== partCount ||
      dto.parts.some((p) => p.partNumber < 1 || p.partNumber > partCount)
    ) {
      throw new BadRequestException(
        `Se esperaban ${partCount} partes, una por número`,
      );
    }

    await this.storage.completeMultipartUpload(
      file.objectKey,
      file.uploadId!,
      dto.parts,
    );

    const head = await this.storage.head(file.objectKey);
    if (!head || head.size !== Number(file.sizeBytes)) {
      await this.storage.delete(file.objectKey).catch(() => undefined);
      await this.prisma.orderProductionFile.update({
        where: { id: file.id },
        data: {
          status: STATUS.deleted,
          deletedAt: new Date(),
          uploadId: null,
        },
      });
      throw new BadRequestException(
        'El tamaño del archivo subido no coincide; vuelve a subirlo',
      );
    }

    const ready = await this.prisma.orderProductionFile.update({
      where: { id: file.id },
      data: {
        status: STATUS.ready,
        uploadId: null,
        completedAt: new Date(),
      },
    });
    await this.audit.record({
      actorUserId: user.userId,
      action: 'order.production_file.uploaded',
      entityType: 'order',
      entityId: orderId,
      metadata: {
        fileId: ready.id,
        fileName: ready.fileName,
        sizeBytes: Number(ready.sizeBytes),
        version: ready.version,
      },
    });
    return this.toView(ready);
  }

  /** Cancela una subida en curso y libera las partes del bucket. */
  async abortUpload(orderId: number, fileId: number, user: RequestingUser) {
    const file = await this.loadUploading(orderId, fileId, user);
    await this.discardUpload(file);
    return { ok: true };
  }

  private async discardUpload(file: OrderProductionFile) {
    if (file.uploadId) {
      await this.storage
        .abortMultipartUpload(file.objectKey, file.uploadId)
        .catch((e) =>
          this.logger.warn(`No se pudo abortar ${file.objectKey}: ${e}`),
        );
    }
    await this.prisma.orderProductionFile.update({
      where: { id: file.id },
      data: { status: STATUS.deleted, deletedAt: new Date(), uploadId: null },
    });
  }

  /** Archivos listos del pedido (más reciente primero). */
  async list(orderId: number, user: RequestingUser) {
    await this.orders.assertOrderAccess(orderId, user);
    const files = await this.prisma.orderProductionFile.findMany({
      where: { orderId, status: STATUS.ready },
      orderBy: { version: 'desc' },
    });
    return files.map((f) => this.toView(f));
  }

  /** URL firmada de descarga directa desde el bucket + registro de quién bajó. */
  async getDownloadUrl(orderId: number, fileId: number, user: RequestingUser) {
    this.requireBucket();
    await this.orders.assertOrderAccess(orderId, user);
    const file = await this.prisma.orderProductionFile.findFirst({
      where: { id: fileId, orderId, status: STATUS.ready },
    });
    if (!file) throw new NotFoundException('Archivo no encontrado');
    const url = await this.storage.getSignedDownloadUrl(
      file.objectKey,
      file.fileName,
      PRODUCTION_DOWNLOAD_URL_SECONDS,
    );
    await this.audit.record({
      actorUserId: user.userId,
      action: 'order.production_file.downloaded',
      entityType: 'order',
      entityId: orderId,
      metadata: { fileId: file.id, fileName: file.fileName },
    });
    return {
      url,
      fileName: file.fileName,
      expiresInSeconds: PRODUCTION_DOWNLOAD_URL_SECONDS,
    };
  }

  /** Borra un archivo listo (soft delete + objeto del bucket). */
  async remove(orderId: number, fileId: number, user: RequestingUser) {
    await this.orders.assertOrderAccess(orderId, user);
    const file = await this.prisma.orderProductionFile.findFirst({
      where: { id: fileId, orderId, status: STATUS.ready },
    });
    if (!file) throw new NotFoundException('Archivo no encontrado');
    this.assertOwnerOrAdmin(file, user);
    await this.storage.delete(file.objectKey);
    await this.prisma.orderProductionFile.update({
      where: { id: file.id },
      data: { status: STATUS.deleted, deletedAt: new Date() },
    });
    await this.audit.record({
      actorUserId: user.userId,
      action: 'order.production_file.deleted',
      entityType: 'order',
      entityId: orderId,
      metadata: { fileId: file.id, fileName: file.fileName },
    });
    return { ok: true };
  }

  /** Aborta las subidas abandonadas (pestaña cerrada a medias). */
  @Cron(CronExpression.EVERY_HOUR)
  async abortStaleUploads(): Promise<number> {
    if (!this.storage.hasObjectStore) return 0;
    const cutoff = new Date(Date.now() - STALE_UPLOAD_HOURS * 3600_000);
    const stale = await this.prisma.orderProductionFile.findMany({
      where: { status: STATUS.uploading, createdAt: { lt: cutoff } },
      take: 100,
    });
    for (const file of stale) await this.discardUpload(file);
    return stale.length;
  }
}
