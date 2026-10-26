import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StorageService } from 'src/storage/storage.service';
import { InMemoryObjectStore } from 'src/storage/testing/in-memory-object-store';
import {
  extensionOf,
  ProductionFileService,
  sanitizeFileName,
} from './production-file.service';
import { PRODUCTION_PART_SIZE } from './production-file.constants';

const GB = 1024 ** 3;
const DESIGNER = { userId: 5, roles: ['diseno'] };
const OTHER = { userId: 9, roles: ['diseno'] };
const ADMIN = { userId: 1, roles: ['admin'] };

describe('ProductionFileService', () => {
  let rows: any[];
  let prisma: any;
  let store: InMemoryObjectStore;
  let service: ProductionFileService;
  let orders: { assertOrderAccess: jest.Mock };
  let audit: { record: jest.Mock };

  const build = (driver: 's3' | 'db' = 's3') => {
    store = new InMemoryObjectStore();
    const storage = new StorageService(driver, store);
    return new ProductionFileService(
      prisma,
      storage,
      orders as any,
      audit as any,
    );
  };

  beforeEach(() => {
    rows = [];
    prisma = {
      orderProductionFile: {
        aggregate: jest.fn(async () => ({
          _max: { version: rows.length ? rows.length : null },
        })),
        create: jest.fn(async ({ data }) => {
          const row = {
            id: rows.length + 1,
            createdAt: new Date(),
            completedAt: null,
            deletedAt: null,
            ...data,
          };
          rows.push(row);
          return row;
        }),
        findFirst: jest.fn(
          async ({ where }) =>
            rows.find(
              (r) =>
                (where.id === undefined || r.id === where.id) &&
                (where.orderId === undefined || r.orderId === where.orderId) &&
                (where.status === undefined || r.status === where.status),
            ) ?? null,
        ),
        findMany: jest.fn(async ({ where }) =>
          rows.filter(
            (r) =>
              (where.orderId === undefined || r.orderId === where.orderId) &&
              r.status === where.status &&
              (!where.createdAt || r.createdAt < where.createdAt.lt),
          ),
        ),
        update: jest.fn(async ({ where, data }) => {
          const row = rows.find((r) => r.id === where.id);
          Object.assign(row, data);
          return row;
        }),
      },
    };
    orders = { assertOrderAccess: jest.fn(async () => ({ id: 1 })) };
    audit = { record: jest.fn() };
    service = build();
  });

  const init = (overrides: any = {}, user = DESIGNER) =>
    service.initUpload(
      1,
      {
        fileName: 'logo final.zip',
        mimeType: 'application/zip',
        sizeBytes: 1.5 * GB,
        ...overrides,
      },
      user,
    );

  it('un archivo de 1.5 GB se parte en 24 URLs firmadas de 64 MiB', async () => {
    const res = await init();
    expect(res.partSize).toBe(PRODUCTION_PART_SIZE);
    expect(res.partCount).toBe(Math.ceil((1.5 * GB) / PRODUCTION_PART_SIZE));
    expect(res.parts).toHaveLength(res.partCount);
    expect(res.parts[0].url).toContain('partNumber=1');
    expect(rows[0]).toMatchObject({
      status: 'uploading',
      version: 1,
      uploadedById: 5,
    });
    expect(rows[0].objectKey).toMatch(
      /^orders\/1\/production\/.+\/logo_final\.zip$/,
    );
  });

  it.each(['.exe', '.docx', ''])('rechaza la extensión %p', async (ext) => {
    await expect(init({ fileName: `x${ext}` })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each(['a.ZIP', 'a.eps', 'a.svg', 'a.dxf', 'a.jpg', 'a.jpeg', 'a.png'])(
    'acepta %s',
    async (fileName) => {
      await expect(init({ fileName, sizeBytes: 10 })).resolves.toBeDefined();
    },
  );

  it('rechaza más de 5 GB', async () => {
    await expect(init({ sizeBytes: 6 * GB })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('sin bucket (driver db) responde 503', async () => {
    service = build('db');
    await expect(init()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('completar con el tamaño correcto deja el archivo listo y audita', async () => {
    const { fileId, partCount } = await init({ sizeBytes: 100 * 1024 * 1024 });
    store.simulatedSizes.set(rows[0].objectKey, 100 * 1024 * 1024);
    const parts = Array.from({ length: partCount }, (_, i) => ({
      partNumber: i + 1,
      etag: `"e${i + 1}"`,
    }));
    const view = await service.completeUpload(1, fileId, { parts }, DESIGNER);
    expect(view).toMatchObject({
      status: 'ready',
      sizeBytes: 100 * 1024 * 1024,
    });
    expect(rows[0].uploadId).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'order.production_file.uploaded' }),
    );
  });

  it('si el tamaño real no coincide borra el objeto y marca deleted', async () => {
    const { fileId, partCount } = await init({ sizeBytes: 100 * 1024 * 1024 });
    store.simulatedSizes.set(rows[0].objectKey, 5);
    const parts = Array.from({ length: partCount }, (_, i) => ({
      partNumber: i + 1,
      etag: 'e',
    }));
    await expect(
      service.completeUpload(1, fileId, { parts }, DESIGNER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rows[0].status).toBe('deleted');
    expect(store.objects.has(rows[0].objectKey)).toBe(false);
  });

  it('completar con partes faltantes o repetidas falla', async () => {
    const { fileId } = await init({ sizeBytes: 3 * PRODUCTION_PART_SIZE });
    await expect(
      service.completeUpload(
        1,
        fileId,
        { parts: [{ partNumber: 1, etag: 'a' }] },
        DESIGNER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.completeUpload(
        1,
        fileId,
        {
          parts: [
            { partNumber: 1, etag: 'a' },
            { partNumber: 1, etag: 'a' },
            { partNumber: 2, etag: 'b' },
          ],
        },
        DESIGNER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('otro usuario no puede completar ni abortar; admin sí', async () => {
    const { fileId } = await init({ sizeBytes: 10 });
    await expect(service.abortUpload(1, fileId, OTHER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.abortUpload(1, fileId, ADMIN)).resolves.toEqual({
      ok: true,
    });
    expect(rows[0].status).toBe('deleted');
  });

  it('re-firmar partes valida el rango', async () => {
    const { fileId } = await init({ sizeBytes: 2 * PRODUCTION_PART_SIZE });
    const ok = await service.signPartsFor(1, fileId, [2], DESIGNER);
    expect(ok.parts[0].url).toContain('partNumber=2');
    await expect(
      service.signPartsFor(1, fileId, [3], DESIGNER),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('descarga: sólo archivos listos, con URL de attachment y auditoría', async () => {
    const { fileId, partCount } = await init({ sizeBytes: 10 });
    await expect(
      service.getDownloadUrl(1, fileId, DESIGNER),
    ).rejects.toBeInstanceOf(NotFoundException);
    store.simulatedSizes.set(rows[0].objectKey, 10);
    await service.completeUpload(
      1,
      fileId,
      {
        parts: Array.from({ length: partCount }, (_, i) => ({
          partNumber: i + 1,
          etag: 'e',
        })),
      },
      DESIGNER,
    );
    const res = await service.getDownloadUrl(1, fileId, {
      userId: 20,
      roles: ['impresiones'],
    });
    expect(res.url).toContain('download=logo%20final.zip');
    expect(orders.assertOrderAccess).toHaveBeenLastCalledWith(1, {
      userId: 20,
      roles: ['impresiones'],
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'order.production_file.downloaded' }),
    );
  });

  it('sin acceso al pedido no se puede ni listar ni descargar', async () => {
    orders.assertOrderAccess.mockRejectedValue(new ForbiddenException());
    await expect(service.list(1, DESIGNER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.getDownloadUrl(1, 1, DESIGNER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('abortStaleUploads descarta las subidas abandonadas', async () => {
    await init({ sizeBytes: 10 });
    rows[0].createdAt = new Date(Date.now() - 48 * 3600_000);
    await expect(service.abortStaleUploads()).resolves.toBe(1);
    expect(rows[0].status).toBe('deleted');
    expect(store.multipartUploads.size).toBe(0);
  });

  it('helpers: sanitizeFileName y extensionOf', () => {
    expect(sanitizeFileName('../../Diseño final (v2).ZIP')).toBe(
      'Diseno_final_v2_.ZIP',
    );
    expect(sanitizeFileName('....')).toBe('archivo');
    expect(extensionOf('a.b.DXF')).toBe('dxf');
    expect(extensionOf('sin')).toBe('');
  });
});
