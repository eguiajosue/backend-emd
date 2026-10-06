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
