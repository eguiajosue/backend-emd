import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { json } from 'express';
import * as request from 'supertest';
import { OrderController } from 'src/order/order.controller';
import { OrderService } from 'src/order/order.service';
import { OrderAreaTaskService } from 'src/order/order-area-task.service';
import { OrderMaterialItemService } from 'src/order/order-material-item.service';
import { StorageService } from 'src/storage/storage.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { BranchController } from './branch.controller';
import { BranchService } from './branch.service';
import { dataUrl, makeJpeg, makePng } from './branch-logo.fixtures';

/**
 * Contrato HTTP real (Nest + guards + ValidationPipe como en main.ts) de los
 * logos de sucursal y de los filtros `branchId`/`origin` de GET /orders.
 */
describe('HTTP: logos de sucursal y filtros de pedidos', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let rows: Record<string, any>[];
  let orderService: { findAll: jest.Mock };

  const token = (roles: string[], sub = 1) =>
    jwt.sign({ sub, username: 'u', roles });
  const as = (roles: string[]) => ({
    Authorization: `Bearer ${token(roles)}`,
  });

  beforeAll(async () => {
    rows = [
      {
        id: 1,
        name: 'Punto Madero',
        active: true,
        logoOnLightData: null,
        logoOnLightKey: null,
        logoOnLightMime: null,
        logoOnDarkData: null,
        logoOnDarkKey: null,
        logoOnDarkMime: null,
        logoUpdatedAt: null,
      },
    ];
    const prisma = {
      branch: {
        findUnique: jest.fn(
          async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
        ),
        findMany: jest.fn(async () => rows),
        update: jest.fn(async ({ where, data }: any) => {
          Object.assign(rows.find((r) => r.id === where.id)!, data);
          return { id: where.id };
        }),
      },
    };
    orderService = { findAll: jest.fn().mockResolvedValue([]) };
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [() => ({ JWT_SECRET: 'secreto-de-prueba' })],
        }),
        JwtModule.register({ secret: 'secreto-de-prueba' }),
      ],
      controllers: [BranchController, OrderController],
      providers: [
        BranchService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: StorageService.database() },
        { provide: OrderService, useValue: orderService },
        { provide: OrderAreaTaskService, useValue: {} },
        { provide: OrderMaterialItemService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    // Mismo límite de cuerpo que main.ts.
    app.use(json({ limit: '10mb' }));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(() => app.close());

  const png = dataUrl('image/png', makePng(300, 100));

  describe('PUT/DELETE /branches/:id/logo/:variant', () => {
    it('401 sin token', async () => {
      await request(app.getHttpServer())
        .put('/branches/1/logo/onLight')
        .send({ imageDataUrl: png })
        .expect(401);
    });

    it.each([['recepcion'], ['diseno'], ['taller'], ['sucursal']])(
      '403 para %s',
      async (role) => {
        await request(app.getHttpServer())
          .put('/branches/1/logo/onLight')
          .set(as([role]))
          .send({ imageDataUrl: png })
          .expect(403);
        await request(app.getHttpServer())
          .delete('/branches/1/logo/onLight')
          .set(as([role]))
          .expect(403);
      },
    );

    it.each([['admin'], ['superuser']])(
      '200 para %s con { branchId, variant, updatedAt }',
      async (role) => {
        const res = await request(app.getHttpServer())
          .put('/branches/1/logo/onDark')
          .set(as([role]))
          .send({ imageDataUrl: dataUrl('image/jpeg', makeJpeg(200, 80)) })
          .expect(200);
        expect(res.body).toEqual({
          branchId: 1,
          variant: 'onDark',
          updatedAt: expect.stringMatching(/Z$/),
        });
      },
    );

    it('400 con variante inválida, body vacío o con campos de más', async () => {
      const admin = as(['admin']);
      await request(app.getHttpServer())
        .put('/branches/1/logo/dark')
        .set(admin)
        .send({ imageDataUrl: png })
        .expect(400);
      await request(app.getHttpServer())
        .put('/branches/1/logo/onLight')
        .set(admin)
        .send({})
        .expect(400);
      await request(app.getHttpServer())
        .put('/branches/1/logo/onLight')
        .set(admin)
        .send({ imageDataUrl: png, active: false })
        .expect(400);
      await request(app.getHttpServer())
        .put('/branches/abc/logo/onLight')
        .set(admin)
        .send({ imageDataUrl: png })
        .expect(400);
    });

    it('400 con SVG y 413 con más de 400 KB', async () => {
      const admin = as(['admin']);
      await request(app.getHttpServer())
        .put('/branches/1/logo/onLight')
        .set(admin)
        .send({
          imageDataUrl: dataUrl('image/svg+xml', Buffer.from('<svg/>')),
        })
        .expect(400);
      await request(app.getHttpServer())
        .put('/branches/1/logo/onLight')
        .set(admin)
        .send({
          imageDataUrl: dataUrl('image/jpeg', makeJpeg(10, 10, 400 * 1024 + 1)),
        })
        .expect(413);
    });

    it('404 si la sucursal no existe', async () => {
      await request(app.getHttpServer())
        .put('/branches/999/logo/onLight')
        .set(as(['admin']))
        .send({ imageDataUrl: png })
        .expect(404);
      await request(app.getHttpServer())
        .delete('/branches/999/logo/onLight')
        .set(as(['admin']))
        .expect(404);
    });

    it('DELETE responde 204 sin cuerpo y quita la variante', async () => {
      const res = await request(app.getHttpServer())
        .delete('/branches/1/logo/onDark')
        .set(as(['superuser']))
        .expect(204);
      expect(res.text).toBe('');
      expect(rows[0].logoOnDarkMime).toBeNull();
    });
  });

  describe('GET /branches/logos', () => {
    it('401 sin token', async () => {
      await request(app.getHttpServer()).get('/branches/logos').expect(401);
    });

    it.each([
      ['sucursal'],
      ['recepcion'],
      ['taller'],
      ['dtf'],
      ['bordado'],
      ['diseno'],
      ['laser'],
      ['impresiones'],
      ['admin'],
      ['superuser'],
    ])('200 para %s (y no lo captura una ruta :id)', async (role) => {
      const res = await request(app.getHttpServer())
        .get('/branches/logos')
        .set(as([role]))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('devuelve el contrato exacto, con Cache-Control privado y ETag (304 al revalidar)', async () => {
      await request(app.getHttpServer())
        .put('/branches/1/logo/onLight')
        .set(as(['admin']))
        .send({ imageDataUrl: png })
        .expect(200);
      const res = await request(app.getHttpServer())
        .get('/branches/logos')
        .set(as(['sucursal']))
        .expect(200);
      expect(res.body).toEqual([
        {
          branchId: 1,
          name: 'Punto Madero',
          logoOnLight: png,
          logoOnDark: null,
          updatedAt: expect.stringMatching(/Z$/),
        },
      ]);
      expect(res.headers['cache-control']).toBe('private, max-age=300');
      expect(res.headers.etag).toBeTruthy();
      await request(app.getHttpServer())
        .get('/branches/logos')
        .set(as(['sucursal']))
        .set('If-None-Match', res.headers.etag)
        .expect(304);
    });
  });

  describe('GET /orders: branchId y origin', () => {
    it('400 con branchId no numérico u origin desconocido', async () => {
      await request(app.getHttpServer())
        .get('/orders?branchId=abc')
        .set(as(['recepcion']))
        .expect(400);
      await request(app.getHttpServer())
        .get('/orders?branchId=1.5')
        .set(as(['recepcion']))
        .expect(400);
      await request(app.getHttpServer())
        .get('/orders?origin=todas')
        .set(as(['admin']))
        .expect(400);
    });

    it('los pasa al service ya tipados junto con los filtros existentes', async () => {
      await request(app.getHttpServer())
        .get(
          '/orders?branchId=3&origin=sucursal&q=abc&statusId=2&page=1&limit=10',
        )
        .set(as(['recepcion']))
        .expect(200);
      const [query, user] = orderService.findAll.mock.calls.at(-1)!;
      expect(query).toMatchObject({
        branchId: 3,
        origin: 'sucursal',
        q: 'abc',
        statusId: 2,
        page: 1,
        limit: 10,
      });
      expect(user).toMatchObject({ roles: ['recepcion'] });
    });

    it('la cuenta de sucursal puede mandarlos (no 400): el service los ignora', async () => {
      await request(app.getHttpServer())
        .get('/orders?branchId=99&origin=matriz')
        .set(as(['sucursal']))
        .expect(200);
      const [, user] = orderService.findAll.mock.calls.at(-1)!;
      expect(user.roles).toEqual(['sucursal']);
    });

    it('vacíos se tratan como ausentes', async () => {
      await request(app.getHttpServer())
        .get('/orders?branchId=&origin=')
        .set(as(['recepcion']))
        .expect(200);
      const [query] = orderService.findAll.mock.calls.at(-1)!;
      expect(query.branchId).toBeUndefined();
      expect(query.origin).toBeUndefined();
    });
  });
});
