import { PrismaClient } from '@prisma/client';
import {
  BackfillLogger,
  backfillBlobs,
  backfillObjectKey,
  BLOB_TARGETS,
} from './blob-backfill';
import { StorageService } from './storage.service';
import { InMemoryObjectStore } from './testing/in-memory-object-store';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PDF_BASE64 = Buffer.from('%PDF-1.4 hola').toString('base64');

type Row = Record<string, any> & { id: number };

/**
 * Delegate de Prisma en memoria con la semántica que usa el backfill:
 * `findMany` (id > cursor, clave null, dato no null, orden por id, take) y
 * `updateMany` con igualdad exacta en el `where`.
 */
function fakeDelegate(rows: Row[]) {
  const matches = (row: Row, where: Record<string, any>) =>
    Object.entries(where).every(([field, cond]) => {
      if (cond && typeof cond === 'object' && 'gt' in cond)
        return row[field] > cond.gt;
      if (cond && typeof cond === 'object' && 'not' in cond)
        return row[field] !== cond.not;
      return (row[field] ?? null) === cond;
    });
  return {
    rows,
    findMany: jest.fn(async (args: any) =>
      rows
        .filter((row) => matches(row, args.where))
        .sort((a, b) => a.id - b.id)
        .slice(0, args.take)
        .map((row) =>
          Object.fromEntries(
            Object.keys(args.select).map((field) => [field, row[field]]),
          ),
        ),
    ),
    findUnique: jest.fn(async (args: any) => {
      const row = rows.find((r) => r.id === args.where.id);
      return row
        ? Object.fromEntries(
            Object.keys(args.select).map((field) => [field, row[field]]),
          )
        : null;
    }),
    updateMany: jest.fn(async (args: any) => {
      const hit = rows.filter((row) => matches(row, args.where));
      hit.forEach((row) => Object.assign(row, args.data));
      return { count: hit.length };
    }),
  };
}

function fakePrisma(seed: Partial<Record<string, Row[]>>) {
  const models = [
    'order',
    'designRevision',
    'designRevisionFile',
    'chatMessage',
    'orderMockup',
    'mockupTemplate',
    'mockupLogo',
  ];
  return Object.fromEntries(
    models.map((model) => [model, fakeDelegate(seed[model] ?? [])]),
  ) as Record<string, ReturnType<typeof fakeDelegate>>;
}

const silentLogger = (): BackfillLogger & Record<string, jest.Mock> => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

describe('backfillBlobs', () => {
  it('cubre todos los blobs del esquema', () => {
    expect(BLOB_TARGETS.map((t) => t.name)).toEqual([
      'Order.clientResourceFile',
      'DesignRevisionFile.data',
      'DesignRevision.montageFile',
      'DesignRevision.feedbackFile',
      'ChatMessage.attachment',
      'OrderMockup.image',
      'MockupTemplate.thumbnail',
      'MockupLogo.image',
      'MockupLogo.thumbnail',
    ]);
  });

  it('claves determinísticas por modelo, id y campo', () => {
    const order = BLOB_TARGETS[0];
    const file = BLOB_TARGETS[1];
    expect(backfillObjectKey(order, 12, 'application/pdf')).toBe(
      'orders/client-resources/backfill/order-12-clientResourceFile.pdf',
    );
    expect(backfillObjectKey(file, 3, 'image/png')).toBe(
      'orders/design-revision-files/backfill/designRevisionFile-3-data.png',
    );
  });

  it('migra las filas legacy por lotes: sube, verifica y recién ahí limpia la columna', async () => {
    const prisma = fakePrisma({
      order: [
        {
          id: 1,
          clientResourceFileData: PDF_BASE64,
          clientResourceFileKey: null,
          clientResourceFileMime: 'application/pdf',
        },
        // Sin archivo: no se toca.
        {
          id: 2,
          clientResourceFileData: null,
          clientResourceFileKey: null,
          clientResourceFileMime: null,
        },
        // Ya migrada: no se toca.
        {
          id: 3,
          clientResourceFileData: null,
          clientResourceFileKey: 'ya/estaba.pdf',
          clientResourceFileMime: 'application/pdf',
        },
      ],
      mockupLogo: [1, 2, 3].map((id) => ({
        id,
        imageData: PNG_BASE64,
        imageKey: null,
        imageMime: 'image/png',
        thumbnailData: PNG_BASE64,
        thumbnailKey: null,
        thumbnailMime: 'image/png',
      })),
    });
    const store = new InMemoryObjectStore();
    const storage = new StorageService('s3', store);
    const logger = silentLogger();

    const report = await backfillBlobs(
      prisma as unknown as PrismaClient,
      storage,
      { dryRun: false, batchSize: 2, logger },
    );

    const order1 = prisma.order.rows[0];
    expect(order1.clientResourceFileData).toBeNull();
    expect(order1.clientResourceFileKey).toBe(
      'orders/client-resources/backfill/order-1-clientResourceFile.pdf',
    );
    expect(store.base64(order1.clientResourceFileKey)).toBe(PDF_BASE64);
    expect(prisma.order.rows[2].clientResourceFileKey).toBe('ya/estaba.pdf');

    for (const logo of prisma.mockupLogo.rows) {
      expect(logo.imageData).toBeNull();
      expect(logo.thumbnailData).toBeNull();
      expect(store.base64(logo.imageKey)).toBe(PNG_BASE64);
      expect(store.base64(logo.thumbnailKey)).toBe(PNG_BASE64);
    }
    // 3 logos en lotes de 2 → 2 lotes con filas + 1 vacío, por campo.
    expect(prisma.mockupLogo.findMany).toHaveBeenCalledTimes(6);

    expect(report.targets['Order.clientResourceFile']).toEqual({
      scanned: 1,
      migrated: 1,
      skipped: 0,
      failed: 0,
      bytes: Buffer.from(PDF_BASE64, 'base64').length,
    });
    expect(report.total.migrated).toBe(7);
    expect(report.total.failed).toBe(0);
  });

  it('es idempotente: una segunda corrida no encuentra nada', async () => {
    const prisma = fakePrisma({
      chatMessage: [
        {
          id: 5,
          attachmentData: PNG_BASE64,
          attachmentKey: null,
          attachmentMimeType: 'image/png',
        },
      ],
    });
    const storage = new StorageService('s3', new InMemoryObjectStore());
    const opts = { dryRun: false, logger: silentLogger() };

    await backfillBlobs(prisma as unknown as PrismaClient, storage, opts);
    const second = await backfillBlobs(
      prisma as unknown as PrismaClient,
      storage,
      opts,
    );

    expect(second.total.scanned).toBe(0);
    expect(prisma.chatMessage.updateMany).toHaveBeenCalledTimes(1);
  });

  it('dry-run cuenta filas y bytes sin subir ni escribir', async () => {
    const prisma = fakePrisma({
      orderMockup: [
        {
          id: 1,
          imageData: PNG_BASE64,
          imageKey: null,
          imageMime: 'image/png',
        },
      ],
    });
    const store = new InMemoryObjectStore();
    const put = jest.spyOn(store, 'put');

    const report = await backfillBlobs(
      prisma as unknown as PrismaClient,
      new StorageService('db', null),
      { dryRun: true, logger: silentLogger() },
    );

    expect(report.dryRun).toBe(true);
    expect(report.targets['OrderMockup.image'].migrated).toBe(1);
    expect(report.total.bytes).toBe(Buffer.from(PNG_BASE64, 'base64').length);
    expect(put).not.toHaveBeenCalled();
    expect(prisma.orderMockup.updateMany).not.toHaveBeenCalled();
    expect(prisma.orderMockup.rows[0].imageData).toBe(PNG_BASE64);
  });

  it('si la verificación del objeto falla, la fila queda intacta y sigue con las demás', async () => {
    const prisma = fakePrisma({
      designRevisionFile: [
        { id: 1, data: PNG_BASE64, dataKey: null, mimeType: 'image/png' },
        { id: 2, data: PDF_BASE64, dataKey: null, mimeType: 'application/pdf' },
      ],
    });
    const store = new InMemoryObjectStore();
    // El primer HEAD devuelve un tamaño distinto (subida truncada).
    jest.spyOn(store, 'head').mockResolvedValueOnce({ size: 1 });
    const logger = silentLogger();

    const report = await backfillBlobs(
      prisma as unknown as PrismaClient,
      new StorageService('s3', store),
      { dryRun: false, logger },
    );

    expect(prisma.designRevisionFile.rows[0]).toMatchObject({
      data: PNG_BASE64,
      dataKey: null,
    });
    expect(prisma.designRevisionFile.rows[1].data).toBeNull();
    expect(report.targets['DesignRevisionFile.data']).toMatchObject({
      migrated: 1,
      failed: 1,
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('verificación fallida'),
    );
  });

  it('si la subida falla no toca la fila', async () => {
    const prisma = fakePrisma({
      mockupTemplate: [
        {
          id: 1,
          thumbnailData: PNG_BASE64,
          thumbnailKey: null,
          thumbnailMime: 'image/png',
        },
      ],
    });
    const store = new InMemoryObjectStore();
    jest.spyOn(store, 'put').mockRejectedValue(new Error('403 AccessDenied'));

    const report = await backfillBlobs(
      prisma as unknown as PrismaClient,
      new StorageService('s3', store),
      { dryRun: false, logger: silentLogger() },
    );

    expect(report.total.failed).toBe(1);
    expect(prisma.mockupTemplate.updateMany).not.toHaveBeenCalled();
    expect(prisma.mockupTemplate.rows[0].thumbnailData).toBe(PNG_BASE64);
  });

  it('si la fila cambió mientras se subía, no la pisa y borra el objeto subido', async () => {
    const prisma = fakePrisma({
      designRevision: [
        {
          id: 9,
          montageFileData: PNG_BASE64,
          montageFileKey: null,
          montageFileMime: 'image/png',
          feedbackFileData: null,
          feedbackFileKey: null,
          feedbackFileMime: null,
        },
      ],
    });
    // Otro proceso reemplaza el archivo entre la lectura y el update.
    prisma.designRevision.updateMany.mockResolvedValueOnce({ count: 0 });
    const store = new InMemoryObjectStore();

    const report = await backfillBlobs(
      prisma as unknown as PrismaClient,
      new StorageService('s3', store),
      { dryRun: false, logger: silentLogger() },
    );

    expect(report.targets['DesignRevision.montageFile'].skipped).toBe(1);
    expect(store.objects.size).toBe(0);
    // El update exige que la fila siga con el MISMO base64 y sin clave.
    expect(prisma.designRevision.updateMany).toHaveBeenCalledWith({
      where: { id: 9, montageFileKey: null, montageFileData: PNG_BASE64 },
      data: {
        montageFileKey:
          'orders/design-revision-files/backfill/designRevision-9-montageFile.png',
        montageFileData: null,
      },
    });
  });

  it('dos corridas simultáneas no borran el objeto que la fila ya referencia', async () => {
    const rows = [
      {
        id: 1,
        imageData: PNG_BASE64,
        imageKey: null,
        thumbnailData: null,
        thumbnailKey: null,
      },
    ];
    const prisma = fakePrisma({ mockupLogo: rows });
    const store = new InMemoryObjectStore();
    const storage = new StorageService('s3', store);
    const opts = {
      dryRun: false,
      only: ['MockupLogo.image'],
      logger: silentLogger(),
    };

    await Promise.all([
      backfillBlobs(prisma as unknown as PrismaClient, storage, opts),
      backfillBlobs(prisma as unknown as PrismaClient, storage, opts),
    ]);

    expect(rows[0].imageData).toBeNull();
    expect(rows[0].imageKey).not.toBeNull();
    expect(store.objects.has(rows[0].imageKey as unknown as string)).toBe(true);
  });

  it('--only limita los campos y sin bucket (no dry-run) se niega a correr', async () => {
    const prisma = fakePrisma({});
    const report = await backfillBlobs(
      prisma as unknown as PrismaClient,
      new StorageService('s3', new InMemoryObjectStore()),
      { dryRun: false, only: ['MockupLogo.image'], logger: silentLogger() },
    );
    expect(Object.keys(report.targets)).toEqual(['MockupLogo.image']);
    expect(prisma.order.findMany).not.toHaveBeenCalled();

    await expect(
      backfillBlobs(
        prisma as unknown as PrismaClient,
        StorageService.database(),
        { dryRun: false, logger: silentLogger() },
      ),
    ).rejects.toThrow(/S3_ENDPOINT/);
  });
});
