import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ObjectNotFoundError, ObjectStore, StoredObject } from './object-store';

/** Configuración del driver S3 (Cloudflare R2 o cualquier S3 compatible). */
export interface S3ObjectStoreConfig {
  /** `https://<accountid>.r2.cloudflarestorage.com` en R2. */
  endpoint: string;
  /** `auto` en R2. */
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Arma el cliente S3 con los ajustes que necesita R2. */
export function createS3Client(config: S3ObjectStoreConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // R2 no soporta virtual-hosted style con todos los nombres de bucket;
    // path-style funciona siempre.
    forcePathStyle: true,
    // Los checksums CRC por defecto de las versiones nuevas del SDK no los
    // entienden todos los S3 compatibles: sólo cuando la operación los exige
    // (recomendación de la documentación de Cloudflare R2).
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/** Errores de "no existe" de S3/R2 (GetObject → NoSuchKey, HeadObject → 404 sin cuerpo). */
function isNotFound(error: any): boolean {
  return (
    error?.name === 'NoSuchKey' ||
    error?.name === 'NotFound' ||
    error?.$metadata?.httpStatusCode === 404
  );
}

/** Driver `s3` de `StorageService`, sobre `@aws-sdk/client-s3`. */
export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
      }),
    );
  }

  async get(key: string): Promise<StoredObject> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) throw new ObjectNotFoundError(key);
      const bytes = await result.Body.transformToByteArray();
      return {
        body: Buffer.from(bytes),
        contentType: result.ContentType ?? null,
      };
    } catch (error) {
      if (isNotFound(error)) throw new ObjectNotFoundError(key);
      throw error;
    }
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { size: result.ContentLength ?? 0 };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
