import { PrismaClient } from '@prisma/client';
import {
  extensionForMime,
  STORAGE_FOLDERS,
  StorageService,
} from './storage.service';

/**
 * Un campo binario a migrar: columna base64 legacy → objeto en el bucket.
 * `model` es el nombre del delegate de Prisma (`prisma.order`, ...).
 */
export interface BlobTarget {
  /** Nombre legible para los logs, ej. `Order.clientResourceFile`. */
  name: string;
  model:
    | 'order'
    | 'designRevision'
    | 'designRevisionFile'
    | 'chatMessage'
    | 'orderMockup'
    | 'mockupTemplate'
    | 'mockupLogo';
  dataField: string;
  keyField: string;
  mimeField: string;
  folder: string;
}

/** Todos los blobs que hoy viven en base64 en Postgres. */
export const BLOB_TARGETS: readonly BlobTarget[] = [
  {
    name: 'Order.clientResourceFile',
    model: 'order',
    dataField: 'clientResourceFileData',
    keyField: 'clientResourceFileKey',
    mimeField: 'clientResourceFileMime',
    folder: STORAGE_FOLDERS.orderClientResource,
  },
  {
    name: 'DesignRevisionFile.data',
    model: 'designRevisionFile',
    dataField: 'data',
    keyField: 'dataKey',
    mimeField: 'mimeType',
    folder: STORAGE_FOLDERS.designRevisionFile,
  },
  {
    name: 'DesignRevision.montageFile',
    model: 'designRevision',
    dataField: 'montageFileData',
    keyField: 'montageFileKey',
    mimeField: 'montageFileMime',
    folder: STORAGE_FOLDERS.designRevisionFile,
  },
  {
    name: 'DesignRevision.feedbackFile',
    model: 'designRevision',
    dataField: 'feedbackFileData',
    keyField: 'feedbackFileKey',
    mimeField: 'feedbackFileMime',
    folder: STORAGE_FOLDERS.designRevisionFile,
  },
  {
    name: 'ChatMessage.attachment',
    model: 'chatMessage',
    dataField: 'attachmentData',
    keyField: 'attachmentKey',
    mimeField: 'attachmentMimeType',
    folder: STORAGE_FOLDERS.chatAttachment,
  },
  {
    name: 'OrderMockup.image',
    model: 'orderMockup',
    dataField: 'imageData',
    keyField: 'imageKey',
    mimeField: 'imageMime',
    folder: STORAGE_FOLDERS.orderMockup,
  },
  {
    name: 'MockupTemplate.thumbnail',
    model: 'mockupTemplate',
    dataField: 'thumbnailData',
    keyField: 'thumbnailKey',
    mimeField: 'thumbnailMime',
    folder: STORAGE_FOLDERS.mockupTemplateThumbnail,
  },
  {
    name: 'MockupLogo.image',
    model: 'mockupLogo',
    dataField: 'imageData',
    keyField: 'imageKey',
    mimeField: 'imageMime',
    folder: STORAGE_FOLDERS.mockupLogoImage,
  },
  {
    name: 'MockupLogo.thumbnail',
    model: 'mockupLogo',
    dataField: 'thumbnailData',
    keyField: 'thumbnailKey',
    mimeField: 'thumbnailMime',
    folder: STORAGE_FOLDERS.mockupLogoThumbnail,
  },
];

/** Contadores de un campo (o del total). */
export interface BackfillCounts {
  /** Filas legacy encontradas (con base64 y sin clave). */
  scanned: number;
  /** Subidas, verificadas y con la fila actualizada (en dry-run: las que se migrarían). */
  migrated: number;
  /** La fila cambió mientras tanto (se borró o ya tiene otro archivo): no se tocó. */
  skipped: number;
  /** Falló la subida o la verificación: la fila queda legacy, intacta. */
  failed: number;
  /** Bytes decodificados de las filas migradas. */
  bytes: number;
}

export interface BackfillReport {
  dryRun: boolean;
  targets: Record<string, BackfillCounts>;
  total: BackfillCounts;
}

export interface BackfillLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface BackfillOptions {
  dryRun: boolean;
  /** Filas por lote (cada una puede pesar varios MB en memoria). */
  batchSize?: number;
  /** Limita la corrida a algunos campos (por `BlobTarget.name`). */
  only?: string[];
  logger: BackfillLogger;
}

const DEFAULT_BATCH_SIZE = 10;

/**
 * Clave DETERMINÍSTICA de un blob migrado: re-correr el backfill después de
 * un corte pisa el mismo objeto en vez de dejar huérfanos.
 */
export function backfillObjectKey(
  target: BlobTarget,
  id: number,
  mimeType: string | null | undefined,
): string {
  const field = target.dataField.replace(/Data$/, '') || target.dataField;
  return `${target.folder}/backfill/${target.model}-${id}-${field}${extensionForMime(
    mimeType ?? '',
  )}`;
}

function emptyCounts(): BackfillCounts {
  return { scanned: 0, migrated: 0, skipped: 0, failed: 0, bytes: 0 };
}

/**
 * Mueve los blobs legacy (base64 en Postgres) al bucket, por lotes.
 *
 * - Idempotente y reanudable: sólo toma filas con base64 y SIN clave, y las
 *   claves son determinísticas.
 * - Nunca borra el base64 sin antes verificar el objeto (HEAD: el tamaño
 *   tiene que coincidir con lo decodificado). El update además exige que la
 *   fila siga teniendo EL MISMO base64 y ninguna clave: si cambió mientras
 *   tanto, no se toca y el objeto subido se borra.
 * - `dryRun`: no sube ni escribe nada, sólo cuenta.
 */
export async function backfillBlobs(
  prisma: PrismaClient,
  storage: StorageService,
  options: BackfillOptions,
): Promise<BackfillReport> {
  const { dryRun, logger } = options;
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  if (!dryRun && !storage.hasObjectStore) {
    throw new Error(
      'El almacenamiento S3/R2 no está configurado: definí S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY',
    );
  }
  const targets = options.only?.length
    ? BLOB_TARGETS.filter((t) => options.only!.includes(t.name))
    : BLOB_TARGETS;

  const report: BackfillReport = {
    dryRun,
    targets: {},
    total: emptyCounts(),
  };

  for (const target of targets) {
    const counts = emptyCounts();
    report.targets[target.name] = counts;
    const delegate = (prisma as any)[target.model];
    let cursor = 0;

    for (;;) {
      const rows: any[] = await delegate.findMany({
        where: {
          id: { gt: cursor },
          [target.keyField]: null,
          [target.dataField]: { not: null },
        },
        select: {
          id: true,
          [target.dataField]: true,
          [target.mimeField]: true,
        },
        orderBy: { id: 'asc' },
        take: batchSize,
      });
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].id;

      for (const row of rows) {
        const data: string = row[target.dataField];
        if (!data) continue;
        counts.scanned++;
        const mimeType: string =
          row[target.mimeField] || 'application/octet-stream';
        const buffer = Buffer.from(data, 'base64');
        if (buffer.length === 0) {
          counts.failed++;
          logger.warn(
            `${target.name} #${row.id}: el base64 está vacío o es inválido, se deja como está`,
          );
          continue;
        }
        if (dryRun) {
          counts.migrated++;
          counts.bytes += buffer.length;
          continue;
        }

        const key = backfillObjectKey(target, row.id, mimeType);
        try {
          await storage.put(key, buffer, mimeType);
          const head = await storage.head(key);
          if (!head || head.size !== buffer.length) {
            throw new Error(
              `verificación fallida: se esperaban ${buffer.length} bytes y el objeto tiene ${head?.size ?? 'ninguno'}`,
            );
          }
        } catch (error) {
          counts.failed++;
          logger.error(
            `${target.name} #${row.id}: no se pudo subir "${key}": ${error?.message ?? error}`,
          );
          continue;
        }

        const { count } = await delegate.updateMany({
          where: {
            id: row.id,
            [target.keyField]: null,
            [target.dataField]: data,
          },
          data: { [target.keyField]: key, [target.dataField]: null },
        });
        if (count === 1) {
          counts.migrated++;
          counts.bytes += buffer.length;
        } else {
          counts.skipped++;
          logger.warn(
            `${target.name} #${row.id}: la fila cambió durante la migración, se deja como está`,
          );
          // La clave es determinística: si otra corrida simultánea ya migró
          // esta fila, la fila apunta a ESTE mismo objeto y borrarlo dejaría
          // el archivo perdido (el base64 ya es null). Sólo se borra si la
          // fila no lo referencia.
          const current = await delegate.findUnique({
            where: { id: row.id },
            select: { [target.keyField]: true },
          });
          if (current?.[target.keyField] !== key) {
            await storage.deleteQuietly([key]);
          }
        }
      }
      logger.log(
        `${target.name}: ${counts.migrated} ${dryRun ? 'a migrar' : 'migradas'}, ${counts.failed} con error (hasta id ${cursor})`,
      );
    }

    for (const field of Object.keys(counts) as (keyof BackfillCounts)[]) {
      report.total[field] += counts[field];
    }
  }

  return report;
}
