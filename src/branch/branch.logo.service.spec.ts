import { HttpStatus, Logger } from '@nestjs/common';
import { StorageService } from 'src/storage/storage.service';
import { createS3StorageForTests } from 'src/storage/testing/in-memory-object-store';
import { BranchService } from './branch.service';
import { dataUrl, makeJpeg, makePng } from './branch-logo.fixtures';

const PNG = makePng(300, 100);
const JPEG = makeJpeg(200, 80);

/** Prisma mínimo con una tabla `branch` en memoria (sólo lo que usa el service). */
function fakePrisma(rows: Record<string, any>[]) {
  const pick = (row: any, select?: Record<string, boolean>) => {
    if (!select) return { ...row };
    return Object.fromEntries(
      Object.keys(select)
        .filter((k) => select[k] === true)
        .map((k) => [k, row[k] ?? null]),
    );
  };
  return {
    rows,
    branch: {
      findUnique: jest.fn(async ({ where, select }) => {
        const row = rows.find((r) => r.id === where.id);
        return row ? pick(row, select) : null;
      }),
      findMany: jest.fn(async ({ where, select }) =>
        rows
          .filter((r) =>
            where?.active === undefined ? true : r.active === where.active,
          )
          .map((r) => pick(r, select)),
      ),
      update: jest.fn(async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw Object.assign(new Error('nf'), { code: 'P2025' });
        Object.assign(row, data);
        return { id: row.id };
      }),
    },
  } as any;
}

const branchRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Punto Madero',
  active: true,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  logoOnLightData: null,
  logoOnLightKey: null,
  logoOnLightMime: null,
  logoOnDarkData: null,
  logoOnDarkKey: null,
  logoOnDarkMime: null,
  logoUpdatedAt: null,
  ...over,
});

describe('BranchService - logos (almacenamiento en la DB)', () => {
  let prisma: any;
  let service: BranchService;

  beforeEach(() => {
    prisma = fakePrisma([branchRow()]);
    service = new BranchService(prisma, StorageService.database());
  });

  it('guarda cada variante en sus propias columnas y responde { branchId, variant, updatedAt }', async () => {
    const light = await service.setLogo(1, 'onLight', {
      imageDataUrl: dataUrl('image/png', PNG),
    });
    expect(light).toEqual({
      branchId: 1,
      variant: 'onLight',
      updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    });
    const row = prisma.rows[0];
    expect(row.logoOnLightData).toBe(PNG.toString('base64'));
    expect(row.logoOnLightKey).toBeNull();
    expect(row.logoOnLightMime).toBe('image/png');
    // La otra variante no se toca.
    expect(row.logoOnDarkMime).toBeNull();
    expect(row.logoUpdatedAt).toBeInstanceOf(Date);

    await service.setLogo(1, 'onDark', {
      imageDataUrl: dataUrl('image/jpeg', JPEG),
    });
    expect(row.logoOnDarkMime).toBe('image/jpeg');
    expect(row.logoOnLightMime).toBe('image/png');
  });

  it('404 si la sucursal no existe (subir y quitar)', async () => {
    await expect(
      service.setLogo(99, 'onLight', {
        imageDataUrl: dataUrl('image/png', PNG),
      }),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    await expect(service.removeLogo(99, 'onDark')).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('una imagen inválida no toca la fila', async () => {
    await expect(
      service.setLogo(1, 'onLight', {
        imageDataUrl: dataUrl('image/svg+xml', Buffer.from('<svg/>')),
      }),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(prisma.branch.update).not.toHaveBeenCalled();
  });

  it('quita una variante y deja la otra', async () => {
    await service.setLogo(1, 'onLight', {
      imageDataUrl: dataUrl('image/png', PNG),
    });
    await service.setLogo(1, 'onDark', {
      imageDataUrl: dataUrl('image/jpeg', JPEG),
    });
    await service.removeLogo(1, 'onLight');
    const row = prisma.rows[0];
    expect(row.logoOnLightData).toBeNull();
    expect(row.logoOnLightMime).toBeNull();
    expect(row.logoOnDarkMime).toBe('image/jpeg');
  });

  it('GET /branches/logos: data URLs, sólo sucursales activas, null donde no hay', async () => {
    prisma = fakePrisma([
      branchRow(),
      branchRow({ id: 2, name: 'Inactiva', active: false }),
      branchRow({ id: 3, name: 'Sin logos' }),
    ]);
    service = new BranchService(prisma, StorageService.database());
    await service.setLogo(1, 'onLight', {
      imageDataUrl: dataUrl('image/png', PNG),
    });

    const logos = await service.findLogos();
    expect(prisma.branch.findMany.mock.calls[0][0].where).toEqual({
      active: true,
    });
    expect(logos.map((l) => l.branchId)).toEqual([1, 3]);
    expect(logos[0]).toEqual({
      branchId: 1,
      name: 'Punto Madero',
      logoOnLight: dataUrl('image/png', PNG),
      logoOnDark: null,
      updatedAt: expect.stringMatching(/Z$/),
    });
    expect(logos[1]).toEqual({
      branchId: 3,
      name: 'Sin logos',
      logoOnLight: null,
      logoOnDark: null,
      updatedAt: null,
    });
  });

  it('GET /branches no devuelve imágenes: sólo hasLogoOn* y logoUpdatedAt', async () => {
    await service.setLogo(1, 'onDark', {
      imageDataUrl: dataUrl('image/jpeg', JPEG),
    });
    prisma.branch.findMany.mockImplementation(async ({ select }: any) =>
      prisma.rows.map((r: any) => ({
        ...Object.fromEntries(
          Object.keys(select)
            .filter((k) => select[k] === true)
            .map((k) => [k, r[k] ?? null]),
        ),
        employees: [],
      })),
    );
    const [branch] = await service.findAll();
    expect(branch).toMatchObject({
      id: 1,
      name: 'Punto Madero',
      hasLogoOnLight: false,
      hasLogoOnDark: true,
      logoUpdatedAt: expect.any(Date),
      employees: [],
    });
    const json = JSON.stringify(branch);
    expect(json).not.toContain(JPEG.toString('base64'));
    expect(Object.keys(branch).filter((k) => /Data|Key|Mime/.test(k))).toEqual(
      [],
    );
    // Y la consulta nunca pide las columnas pesadas.
    const select = prisma.branch.findMany.mock.calls[0][0].select;
    expect(select.logoOnLightData).toBeUndefined();
    expect(select.logoOnDarkData).toBeUndefined();
  });
});

describe('BranchService - logos (bucket R2/S3)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('sube al bucket, guarda sólo la clave, reemplaza borrando el objeto viejo y lo lee de vuelta', async () => {
    const { store, storage } = createS3StorageForTests();
    const prisma = fakePrisma([branchRow()]);
    const service = new BranchService(prisma, storage);

    await service.setLogo(1, 'onLight', {
      imageDataUrl: dataUrl('image/png', PNG),
    });
    const row = prisma.rows[0];
    expect(row.logoOnLightData).toBeNull();
    expect(row.logoOnLightKey).toMatch(/^branches\/logos\/.+\.png$/);
    expect(store.base64(row.logoOnLightKey)).toBe(PNG.toString('base64'));
    const firstKey = row.logoOnLightKey;

    const logos = await service.findLogos();
    expect(logos[0].logoOnLight).toBe(dataUrl('image/png', PNG));

    await service.setLogo(1, 'onLight', {
      imageDataUrl: dataUrl('image/jpeg', JPEG),
    });
    expect(row.logoOnLightKey).not.toBe(firstKey);
    expect(store.objects.has(firstKey)).toBe(false);
    expect(store.objects.size).toBe(1);

    await service.removeLogo(1, 'onLight');
    expect(store.objects.size).toBe(0);
    expect(row.logoOnLightKey).toBeNull();
    expect(row.logoOnLightMime).toBeNull();
  });

  it('lee filas legacy (base64) aunque el driver sea s3', async () => {
    const { storage } = createS3StorageForTests();
    const prisma = fakePrisma([
      branchRow({
        logoOnDarkData: PNG.toString('base64'),
        logoOnDarkMime: 'image/png',
      }),
    ]);
    const [item] = await new BranchService(prisma, storage).findLogos();
    expect(item.logoOnDark).toBe(dataUrl('image/png', PNG));
  });

  it('un objeto perdido sale null y no tira el listado', async () => {
    const { storage } = createS3StorageForTests();
    const prisma = fakePrisma([
      branchRow({
        logoOnLightKey: 'branches/logos/perdido.png',
        logoOnLightMime: 'image/png',
      }),
      branchRow({ id: 2, name: 'Otra' }),
    ]);
    const logos = await new BranchService(prisma, storage).findLogos();
    expect(logos).toHaveLength(2);
    expect(logos[0].logoOnLight).toBeNull();
  });

  it('si falla el guardado en la fila, borra el objeto recién subido', async () => {
    const { store, storage } = createS3StorageForTests();
    const prisma = fakePrisma([branchRow()]);
    prisma.branch.update.mockRejectedValueOnce(new Error('db caída'));
    await expect(
      new BranchService(prisma, storage).setLogo(1, 'onLight', {
        imageDataUrl: dataUrl('image/png', PNG),
      }),
    ).rejects.toThrow('db caída');
    expect(store.objects.size).toBe(0);
  });
});
