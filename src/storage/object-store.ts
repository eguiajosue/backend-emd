/**
 * Contrato mínimo de un almacenamiento de objetos (R2/S3). Lo implementa
 * `S3ObjectStore`; los tests lo reemplazan por un doble en memoria.
 */
export interface ObjectStore {
  /** Sube (o pisa) el objeto `key`. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Descarga el objeto completo. Lanza `ObjectNotFoundError` si no existe. */
  get(key: string): Promise<StoredObject>;
  /** Metadatos del objeto (tamaño en bytes) o `null` si no existe. */
  head(key: string): Promise<{ size: number } | null>;
  /** Borra el objeto. Borrar uno inexistente no es un error (semántica S3). */
  delete(key: string): Promise<void>;
  /** URL GET firmada, válida `expiresInSeconds` segundos. */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  /**
   * URL GET firmada que fuerza la descarga con `fileName` (Content-Disposition:
   * attachment). Para archivos grandes que bajan directo del bucket.
   */
  getSignedDownloadUrl(
    key: string,
    fileName: string,
    expiresInSeconds: number,
  ): Promise<string>;

  // ─── Subida por partes (multipart) para archivos de varios GB ──────────
  /** Abre una subida por partes y devuelve su `uploadId`. */
  createMultipartUpload(key: string, contentType: string): Promise<string>;
  /** URL PUT firmada para la parte `partNumber` (1..10000). */
  signUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds: number,
  ): Promise<string>;
  /** Cierra la subida juntando las partes (con el ETag de cada una). */
  completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<void>;
  /** Cancela la subida y libera las partes ya subidas. Idempotente. */
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
}

/** Una parte ya subida: su número y el ETag que devolvió el bucket. */
export interface MultipartPart {
  partNumber: number;
  etag: string;
}

/** Contenido descargado de un objeto. */
export interface StoredObject {
  body: Buffer;
  contentType: string | null;
}

/** El objeto pedido no existe en el bucket. */
export class ObjectNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`El objeto "${key}" no existe en el almacenamiento`);
    this.name = 'ObjectNotFoundError';
  }
}
