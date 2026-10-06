import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { HttpStatus, Logger } from '@nestjs/common';
import { ObjectNotFoundError } from './object-store';
import { S3ObjectStore } from './s3-object-store';
import {
  buildObjectKey,
  extensionForMime,
  hasBlob,
  mapWithConcurrency,
  STORAGE_FOLDERS,
  StorageService,
} from './storage.service';
import { createStorageService } from './storage.module';
import {
  createS3StorageForTests,
  InMemoryObjectStore,
} from './testing/in-memory-object-store';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/** Cliente S3 falso: sólo `send`, que el test programa por comando. */
function fakeS3Client(send: jest.Mock) {
  return { send } as unknown as S3Client;
}

describe('S3ObjectStore', () => {
  it('put manda PutObject con bucket, clave, cuerpo, tipo y largo', async () => {
    const send = jest.fn().mockResolvedValue({});
    const store = new S3ObjectStore(fakeS3Client(send), 'emd-archivos');

    await store.put('a/b.png', Buffer.from('hola'), 'image/png');

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'emd-archivos',
      Key: 'a/b.png',
      Body: Buffer.from('hola'),
      ContentType: 'image/png',
      ContentLength: 4,
    });
  });

  it('get devuelve el cuerpo como Buffer y el content type', async () => {
    const send = jest.fn().mockResolvedValue({
      Body: {
        transformToByteArray: async () => new Uint8Array([1, 2, 3]),
      },
      ContentType: 'application/pdf',
    });
    const store = new S3ObjectStore(fakeS3Client(send), 'bkt');

    const result = await store.get('x.pdf');

    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
    expect(send.mock.calls[0][0].input).toEqual({
      Bucket: 'bkt',
      Key: 'x.pdf',
    });
    expect(result.body.equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(result.contentType).toBe('application/pdf');
  });

  it('get traduce NoSuchKey a ObjectNotFoundError', async () => {
    const error = Object.assign(new Error('no'), { name: 'NoSuchKey' });
    const store = new S3ObjectStore(
      fakeS3Client(jest.fn().mockRejectedValue(error)),
      'bkt',
    );
    await expect(store.get('nope')).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('get relanza los errores que no son "no existe"', async () => {
    const error = Object.assign(new Error('AccessDenied'), {
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    });
    const store = new S3ObjectStore(
      fakeS3Client(jest.fn().mockRejectedValue(error)),
      'bkt',
    );
    await expect(store.get('k')).rejects.toBe(error);
  });

  it('head devuelve el tamaño, o null si el objeto no existe (404)', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ ContentLength: 42 })
      .mockRejectedValueOnce(
        Object.assign(new Error(''), {
          name: 'Unknown',
          $metadata: { httpStatusCode: 404 },
        }),
      );
    const store = new S3ObjectStore(fakeS3Client(send), 'bkt');

    await expect(store.head('a')).resolves.toEqual({ size: 42 });
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
    await expect(store.head('b')).resolves.toBeNull();
  });

  it('delete manda DeleteObject', async () => {
    const send = jest.fn().mockResolvedValue({});
    const store = new S3ObjectStore(fakeS3Client(send), 'bkt');
    await store.delete('k');
    expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
    expect(send.mock.calls[0][0].input).toEqual({ Bucket: 'bkt', Key: 'k' });
  });

  it('getSignedUrl firma un GET del objeto con el vencimiento pedido', async () => {
    const client = new S3Client({
      region: 'auto',
      endpoint: 'https://cuenta.r2.cloudflarestorage.com',
      forcePathStyle: true,
      credentials: { accessKeyId: 'AKID', secretAccessKey: 'SECRET' },
    });
    const store = new S3ObjectStore(client, 'bkt');

    const url = await store.getSignedUrl('orders/a.png', 120);

    expect(url).toContain(
      'https://cuenta.r2.cloudflarestorage.com/bkt/orders/a.png?',
    );
    expect(url).toContain('X-Amz-Expires=120');
    expect(url).toContain('X-Amz-Signature=');
  });
});

describe('helpers de storage', () => {
  it('extensionForMime conoce los tipos que sube la app', () => {
    expect(extensionForMime('image/png')).toBe('.png');
    expect(extensionForMime('image/jpeg')).toBe('.jpg');
    expect(extensionForMime('application/pdf')).toBe('.pdf');
    expect(extensionForMime('audio/webm')).toBe('.webm');
    expect(extensionForMime('application/x-raro')).toBe('');
  });

  it('buildObjectKey arma <carpeta>/<uuid>.<ext> único', () => {
    const a = buildObjectKey(STORAGE_FOLDERS.orderMockup, 'image/png');
    const b = buildObjectKey(STORAGE_FOLDERS.orderMockup, 'image/png');
    expect(a).toMatch(/^orders\/mockups\/[0-9a-f-]{36}\.png$/);
    expect(a).not.toBe(b);
  });

  it('hasBlob mira la clave o el base64', () => {
    expect(hasBlob({ data: 'AA==' })).toBe(true);
    expect(hasBlob({ key: 'k' })).toBe(true);
    expect(hasBlob({ data: null, key: null })).toBe(false);
    expect(hasBlob(null)).toBe(false);
  });

  it('mapWithConcurrency respeta el tope y el orden', async () => {
    let running = 0;
    let maxRunning = 0;
    const result = await mapWithConcurrency(
      [1, 2, 3, 4, 5, 6, 7],
      3,
      async (n) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return n * 10;
      },
    );
    expect(result).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(maxRunning).toBe(3);
  });
});

describe('StorageService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('driver s3 sin bucket configurado no arranca', () => {
    expect(() => new StorageService('s3', null)).toThrow(/STORAGE_DRIVER=s3/);
  });

  describe('driver db (legacy)', () => {
    const storage = StorageService.database();

    it('saveBase64 deja el base64 para la columna y no genera clave', async () => {
      await expect(
        storage.saveBase64('x', PNG_BASE64, 'image/png'),
      ).resolves.toEqual({ data: PNG_BASE64, key: null });
    });

    it('loadBase64 / toDataUrl leen la columna', async () => {
      await expect(storage.loadBase64({ data: PNG_BASE64 })).resolves.toBe(
        PNG_BASE64,
      );
      await expect(
        storage.toDataUrl('image/png', { data: PNG_BASE64, key: null }),
      ).resolves.toBe(`data:image/png;base64,${PNG_BASE64}`);
      await expect(storage.toDataUrl('image/png', {})).resolves.toBeNull();
    });

    it('una fila migrada sin bucket configurado responde 500 (no la columna vacía)', async () => {
      await expect(
        storage.loadBase64({ data: null, key: 'k' }),
      ).rejects.toMatchObject({ status: HttpStatus.INTERNAL_SERVER_ERROR });
    });

    it('deleteQuietly sin bucket no falla', async () => {
      await expect(storage.deleteQuietly(['k'])).resolves.toBeUndefined();
    });
  });

  describe('driver s3', () => {
    it('saveBase64 sube el binario decodificado y deja la columna en null', async () => {
      const { storage, store } = createS3StorageForTests();

      const blob = await storage.saveBase64(
        STORAGE_FOLDERS.chatAttachment,
        PNG_BASE64,
        'image/png',
      );

      expect(blob.data).toBeNull();
      expect(blob.key).toMatch(/^chat\/attachments\/.+\.png$/);
      expect(store.base64(blob.key!)).toBe(PNG_BASE64);
      expect(store.objects.get(blob.key!)!.contentType).toBe('image/png');
    });

    it('loadBase64 prefiere la clave sobre la columna', async () => {
      const { storage, store } = createS3StorageForTests();
      await store.put('k', Buffer.from(PNG_BASE64, 'base64'), 'image/png');

      await expect(
        storage.loadBase64({ data: 'VIEJO', key: 'k' }),
      ).resolves.toBe(PNG_BASE64);
      // Fila legacy (sin clave): sigue saliendo de la columna.
      await expect(storage.loadBase64({ data: 'VIEJO' })).resolves.toBe(
        'VIEJO',
      );
    });

    it('un objeto que no existe es un 500 en lecturas puntuales y null en listados', async () => {
      const { storage } = createS3StorageForTests();
      await expect(storage.loadBase64({ key: 'falta' })).rejects.toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      });
      await expect(storage.loadBase64OrNull({ key: 'falta' })).resolves.toBe(
        null,
      );
    });

    it('loadManyBase64OrNull resuelve una mezcla de filas legacy y migradas', async () => {
      const { storage, store } = createS3StorageForTests();
      await store.put('k1', Buffer.from('uno'), 'text/plain');

      await expect(
        storage.loadManyBase64OrNull([
          { key: 'k1' },
          { data: 'ZG9z' },
          null,
          { key: 'roto' },
        ]),
      ).resolves.toEqual([
        Buffer.from('uno').toString('base64'),
        'ZG9z',
        null,
        null,
      ]);
    });

    it('saveManyBase64 borra lo ya subido si un archivo falla', async () => {
      const store = new InMemoryObjectStore();
      const storage = new StorageService('s3', store);
      const put = jest.spyOn(store, 'put');
      put.mockImplementationOnce(InMemoryObjectStore.prototype.put.bind(store));
      put.mockRejectedValueOnce(new Error('R2 caído'));

      await expect(
        storage.saveManyBase64('f', [
          { data: PNG_BASE64, mimeType: 'image/png' },
          { data: PNG_BASE64, mimeType: 'image/png' },
        ]),
      ).rejects.toThrow('R2 caído');
      expect(store.objects.size).toBe(0);
    });

    it('deleteQuietly ignora nulos/repetidos y no propaga errores', async () => {
      const store = new InMemoryObjectStore();
      const storage = new StorageService('s3', store);
      const del = jest
        .spyOn(store, 'delete')
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('timeout'));

      await expect(
        storage.deleteQuietly(['a', null, 'a', undefined, 'b']),
      ).resolves.toBeUndefined();
      expect(del.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('"b"'),
      );
    });

    it('getSignedUrl delega en el bucket', async () => {
      const { storage } = createS3StorageForTests();
      await expect(storage.getSignedUrl('k', 60)).resolves.toBe(
        'https://bucket.test/k?expires=60',
      );
    });
  });
});

describe('createStorageService', () => {
  const s3Env = {
    S3_ENDPOINT: 'https://cuenta.r2.cloudflarestorage.com',
    S3_REGION: 'auto',
    S3_BUCKET: 'bkt',
    S3_ACCESS_KEY_ID: 'id',
    S3_SECRET_ACCESS_KEY: 'secret',
  };

  it('sin variables S3: driver db y sin bucket', () => {
    const storage = createStorageService({
      STORAGE_DRIVER: 'db',
      S3_REGION: 'auto',
    } as any);
    expect(storage.driver).toBe('db');
    expect(storage.hasObjectStore).toBe(false);
    expect(storage.writesToObjectStorage).toBe(false);
  });

  it('driver s3 con las variables completas escribe en el bucket', () => {
    const storage = createStorageService({ STORAGE_DRIVER: 's3', ...s3Env });
    expect(storage.writesToObjectStorage).toBe(true);
    expect(storage.hasObjectStore).toBe(true);
  });

  it('rollback: driver db con S3 configurado sigue pudiendo leer lo migrado', () => {
    const storage = createStorageService({ STORAGE_DRIVER: 'db', ...s3Env });
    expect(storage.writesToObjectStorage).toBe(false);
    expect(storage.hasObjectStore).toBe(true);
  });
});
