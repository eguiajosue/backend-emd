import {
  MultipartPart,
  ObjectNotFoundError,
  ObjectStore,
  StoredObject,
} from '../object-store';
import { StorageService } from '../storage.service';

/**
 * `ObjectStore` en memoria para tests: mismo contrato que el bucket real
 * (get de una clave inexistente → `ObjectNotFoundError`, delete idempotente).
 */
export class InMemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, StoredObject>();
  /** Tamaño a informar en `head` (objetos multipart grandes que no se materializan). */
  readonly simulatedSizes = new Map<string, number>();

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  async get(key: string): Promise<StoredObject> {
    const object = this.objects.get(key);
    if (!object) throw new ObjectNotFoundError(key);
    return { body: Buffer.from(object.body), contentType: object.contentType };
  }

  async head(key: string): Promise<{ size: number } | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return { size: this.simulatedSizes.get(key) ?? object.body.length };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return `https://bucket.test/${key}?expires=${expiresInSeconds}`;
  }

  async getSignedDownloadUrl(
    key: string,
    fileName: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return `https://bucket.test/${key}?download=${encodeURIComponent(fileName)}&expires=${expiresInSeconds}`;
  }

  /** Subidas por partes abiertas: uploadId → clave. */
  readonly multipartUploads = new Map<string, string>();
  /** Partes con que se completó cada clave (para asserts). */
  readonly completedParts = new Map<string, MultipartPart[]>();

  async createMultipartUpload(key: string): Promise<string> {
    const uploadId = `upload-${this.multipartUploads.size + 1}`;
    this.multipartUploads.set(uploadId, key);
    return uploadId;
  }

  async signUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds: number,
  ): Promise<string> {
    return `https://bucket.test/${key}?uploadId=${uploadId}&partNumber=${partNumber}&expires=${expiresInSeconds}`;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<void> {
    this.multipartUploads.delete(uploadId);
    this.completedParts.set(key, parts);
    this.objects.set(key, { body: Buffer.alloc(0), contentType: null });
  }

  async abortMultipartUpload(_key: string, uploadId: string): Promise<void> {
    this.multipartUploads.delete(uploadId);
  }

  /** Contenido de un objeto en base64 (para asserts). */
  base64(key: string): string | undefined {
    return this.objects.get(key)?.body.toString('base64');
  }
}

/** `StorageService` con driver `s3` sobre un bucket en memoria. */
export function createS3StorageForTests() {
  const store = new InMemoryObjectStore();
  return { store, storage: new StorageService('s3', store) };
}
