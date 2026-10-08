import { InternalServerErrorException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ObjectStore, StoredObject } from './object-store';

/**
 * Dónde se guardan los archivos NUEVOS:
 *  - `db`: como siempre, base64 en la columna de Postgres (default).
 *  - `s3`: en el bucket (Cloudflare R2), y en la fila sólo la clave.
 */
export type StorageDriver = 'db' | 's3';

/**
 * Referencia a un archivo guardado en una fila: o el base64 legacy en la
 * columna (`data`), o la clave del objeto en el bucket (`key`). Si están las
 * dos, manda la clave.
 */
export interface BlobRef {
  data?: string | null;
  key?: string | null;
}

/** Lo que hay que escribir en la fila al guardar un archivo. */
export interface StoredBlob {
  data: string | null;
  key: string | null;
}

/**
 * Carpetas (prefijos de clave) por tipo de archivo. Las claves nuevas son
 * `<carpeta>/<uuid>.<ext>`: no dependen del id de la fila (que en un alta
 * todavía no existe) y no se pisan entre sí.
 */
export const STORAGE_FOLDERS = {
  orderClientResource: 'orders/client-resources',
  designRevisionFile: 'orders/design-revision-files',
  orderMockup: 'orders/mockups',
  chatAttachment: 'chat/attachments',
  mockupTemplateThumbnail: 'mockup-templates/thumbnails',
  mockupLogoImage: 'mockup-logos/images',
  mockupLogoThumbnail: 'mockup-logos/thumbnails',
  branchLogo: 'branches/logos',
  sampleTestPhoto: 'orders/sample-test-photos',
} as const;

/** Lecturas en paralelo como máximo al armar un listado (chat, plantillas). */
const LIST_READ_CONCURRENCY = 6;

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/webm': '.webm',
  'audio/wav': '.wav',
};

/** Extensión de archivo para un mime type ('' si no se conoce). */
export function extensionForMime(mimeType: string): string {
  return EXTENSIONS[mimeType?.toLowerCase()] ?? '';
}

/** Clave nueva y única dentro de `folder`. */
export function buildObjectKey(folder: string, mimeType: string): string {
  return `${folder}/${randomUUID()}${extensionForMime(mimeType)}`;
}

/** `true` si la fila tiene archivo (legacy o en el bucket). */
export function hasBlob(ref: BlobRef | null | undefined): boolean {
  return Boolean(ref?.key || ref?.data);
}

/**
 * `Promise.all` con tope de concurrencia: un listado de 100 mensajes con
 * adjunto no abre 100 descargas a la vez contra el bucket.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Fachada única sobre el almacenamiento de archivos.
 *
 * Las filas pueden ser LEGACY (base64 en la columna) o MIGRADAS (clave del
 * objeto en el bucket). Las lecturas resuelven las dos formas, así que el
 * contrato HTTP no cambia (se siguen devolviendo data URLs). Las escrituras
 * van al bucket sólo con `STORAGE_DRIVER=s3`.
 *
 * El cliente S3 se arma siempre que las variables S3_* estén completas,
 * aunque el driver sea `db`: así volver a `STORAGE_DRIVER=db` (rollback) deja
 * de escribir en el bucket pero sigue pudiendo LEER lo que ya se migró.
 */
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    readonly driver: StorageDriver,
    private readonly store: ObjectStore | null,
  ) {
    if (driver === 's3' && !store) {
      throw new Error(
        'STORAGE_DRIVER=s3 requiere configurar el almacenamiento S3 (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)',
      );
    }
  }

  /** Servicio con el comportamiento legacy (todo en la DB). Útil en tests. */
  static database(): StorageService {
    return new StorageService('db', null);
  }

  /** `true` si los archivos nuevos se suben al bucket. */
  get writesToObjectStorage(): boolean {
    return this.driver === 's3';
  }

  /** `true` si hay bucket configurado (para leer filas ya migradas). */
  get hasObjectStore(): boolean {
    return this.store != null;
  }

  // ─── Operaciones crudas sobre el bucket ────────────────────────────────

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.requireStore().put(key, body, contentType);
  }

  async get(key: string): Promise<StoredObject> {
    return this.requireStore().get(key);
  }

  async head(key: string): Promise<{ size: number } | null> {
    return this.requireStore().head(key);
  }

  async delete(key: string): Promise<void> {
    await this.requireStore().delete(key);
  }

  /** URL GET firmada (por defecto 5 minutos). */
  async getSignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return this.requireStore().getSignedUrl(key, expiresInSeconds);
  }

  // ─── Archivos de las filas (base64 legacy ↔ objeto) ────────────────────

  /**
   * Guarda un archivo que llegó en base64 (sin prefijo `data:`). Con driver
   * `db` no toca nada y devuelve el base64 para la columna; con `s3` lo sube
   * y devuelve la clave (la columna base64 queda en null).
   */
  async saveBase64(
    folder: string,
    base64: string,
    mimeType: string,
  ): Promise<StoredBlob> {
    if (!this.writesToObjectStorage) return { data: base64, key: null };
    const key = buildObjectKey(folder, mimeType);
    await this.put(key, Buffer.from(base64, 'base64'), mimeType);
    return { data: null, key };
  }

  /** Guarda varios archivos; si uno falla, borra los ya subidos y relanza. */
  async saveManyBase64(
    folder: string,
    files: readonly { data: string; mimeType: string }[],
  ): Promise<StoredBlob[]> {
    const saved: StoredBlob[] = [];
    try {
      for (const file of files) {
        saved.push(await this.saveBase64(folder, file.data, file.mimeType));
      }
      return saved;
    } catch (error) {
      await this.deleteQuietly(saved.map((blob) => blob.key));
      throw error;
    }
  }

  /**
   * Contenido en base64 de una fila (de la columna o del bucket), o `null`
   * si la fila no tiene archivo. Si la clave existe pero el objeto no se
   * puede leer lanza 500: es una inconsistencia del servidor, no del cliente.
   */
  async loadBase64(ref: BlobRef | null | undefined): Promise<string | null> {
    if (ref?.key) {
      try {
        const { body } = await this.requireStore().get(ref.key);
        return body.toString('base64');
      } catch (error) {
        this.logger.error(
          `No se pudo leer el objeto "${ref.key}": ${error?.message ?? error}`,
        );
        throw new InternalServerErrorException(
          'No se pudo leer el archivo del almacenamiento',
        );
      }
    }
    return ref?.data ?? null;
  }

  /**
   * Igual que `loadBase64`, pero un objeto ilegible devuelve `null` (y queda
   * logueado) en vez de tirar abajo un listado entero por un solo archivo.
   */
  async loadBase64OrNull(
    ref: BlobRef | null | undefined,
  ): Promise<string | null> {
    try {
      return await this.loadBase64(ref);
    } catch {
      return null;
    }
  }

  /** Varios `loadBase64OrNull` con concurrencia acotada, en el mismo orden. */
  async loadManyBase64OrNull(
    refs: readonly (BlobRef | null | undefined)[],
  ): Promise<(string | null)[]> {
    return mapWithConcurrency(refs, LIST_READ_CONCURRENCY, (ref) =>
      this.loadBase64OrNull(ref),
    );
  }

  /** `data:<mime>;base64,<...>` de una fila, o `null` si no tiene archivo. */
  async toDataUrl(
    mimeType: string | null | undefined,
    ref: BlobRef | null | undefined,
  ): Promise<string | null> {
    const base64 = await this.loadBase64(ref);
    return base64 == null ? null : `data:${mimeType};base64,${base64}`;
  }

  /**
   * Borra objetos del bucket a mejor esfuerzo: ignora nulos y repetidos, y un
   * fallo sólo se loguea (la fila ya se borró; un objeto huérfano es basura,
   * no un error para el usuario).
   */
  async deleteQuietly(
    keys: Iterable<string | null | undefined>,
  ): Promise<void> {
    const unique = [...new Set([...keys].filter((k): k is string => !!k))];
    if (unique.length === 0) return;
    if (!this.store) {
      this.logger.warn(
        `No se borraron ${unique.length} objeto(s) del almacenamiento: S3 no está configurado`,
      );
      return;
    }
    const results = await Promise.allSettled(
      unique.map((key) => this.store!.delete(key)),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.warn(
          `No se pudo borrar el objeto "${unique[index]}": ${
            result.reason?.message ?? result.reason
          }`,
        );
      }
    });
  }

  private requireStore(): ObjectStore {
    if (!this.store) {
      throw new Error(
        'El almacenamiento de objetos (S3/R2) no está configurado: faltan las variables S3_*',
      );
    }
    return this.store;
  }
}
