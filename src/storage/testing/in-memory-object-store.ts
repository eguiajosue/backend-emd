import {
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
    return object ? { size: object.body.length } : null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return `https://bucket.test/${key}?expires=${expiresInSeconds}`;
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
