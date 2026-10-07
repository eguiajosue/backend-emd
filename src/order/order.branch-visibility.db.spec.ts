import { HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderService } from './order.service';
import { OrderAreaTaskService } from './order-area-task.service';
import { OrderController } from './order.controller';
import { OrderMaterialItemService } from './order-material-item.service';
import { OrderMockupService } from 'src/order-mockup/order-mockup.service';
import { NotificationService } from 'src/notification/notification.service';
import { OrderListQueryDto } from './dto/order-list-query.dto';
import { makePng } from 'src/branch/branch-logo.fixtures';

/**
 * BARRIDO DE VISIBILIDAD contra Postgres REAL (sin mocks de Prisma): una
 * cuenta de sucursal NO ve pedidos de la matriz ni de otra sucursal por
 * NINGUNA vía (listado, detalle, avance, hoja de autorización, mockups,
 * notificaciones), y la matriz (Recepción/admin) sí ve todos.
 *
 * Sólo corre con una base descartable migrada a HEAD y sembrada (roles):
 *   BRANCH_TEST_DATABASE_URL="postgresql://postgres@localhost:5499/<db>?host=/tmp" npx jest order.branch-visibility.db
 */
const URL = process.env.BRANCH_TEST_DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

const PNG_B64 = makePng(10, 10).toString('base64');

describeDb('Visibilidad de pedidos por sucursal (Postgres real)', () => {
  let prisma: PrismaService;
  let orders: OrderService;
  let tasks: OrderAreaTaskService;
  let controller: OrderController;
  let mockups: OrderMockupService;
  let notifications: NotificationService;

  const suffix = `${Date.now()}`;
  const ids = {
    branchA: 0,
    branchB: 0,
    userA: 0,
    userB: 0,
    recep: 0,
    admin: 0,
    taller: 0,
    orderM: 0, // matriz
    orderA: 0, // sucursal A
    orderB: 0, // sucursal B
    revM: 0,
    revA: 0,
    revFileM: 0,
    mockupM: 0,
    mockupA: 0,
  };
  let statusId: number;
  const createdStatusIds: number[] = [];

  const asBranchA = () => ({ userId: ids.userA, roles: ['sucursal'] });
  const asBranchB = () => ({ userId: ids.userB, roles: ['sucursal'] });
  const asRecep = () => ({ userId: ids.recep, roles: ['recepcion'] });
  const asAdmin = () => ({ userId: ids.admin, roles: ['admin'] });
  const token = (u: { userId: number; roles: string[] }) => ({
    sub: u.userId,
    username: 'x',
    roles: u.roles,
  });
  const query = (q: Partial<OrderListQueryDto> = {}) =>
    Object.assign(new OrderListQueryDto(), q);
  const idsOf = (list: any): number[] =>
    (Array.isArray(list) ? list : list.data).map((o: any) => o.id);
  const mine = (list: any) =>
    idsOf(list).filter((id) =>
      [ids.orderM, ids.orderA, ids.orderB].includes(id),
    );

  const forbidden = { status: HttpStatus.FORBIDDEN };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    prisma = new PrismaService();
    await prisma.$connect();

    const status =
      (await prisma.status.findFirst()) ??
      (await prisma.status.create({ data: { name: `vis-${suffix}` } }));
    statusId = status.id;
    if (!(await prisma.status.findFirst({ where: { id: status.id } }))) {
      createdStatusIds.push(status.id);
    }

    const role = async (name: string) =>
      (
        await prisma.role.upsert({
          where: { name },
          update: {},
          create: { name },
        })
      ).id;
    const [sucursal, recepcion, admin, taller] = await Promise.all([
      role('sucursal'),
      role('recepcion'),
      role('admin'),
      role('taller'),
    ]);

    ids.branchA = (
      await prisma.branch.create({ data: { name: `Sucursal A ${suffix}` } })
    ).id;
    ids.branchB = (
      await prisma.branch.create({ data: { name: `Sucursal B ${suffix}` } })
    ).id;
    const user = async (name: string, roleId: number, branchId?: number) =>
      (
        await prisma.user.create({
          data: {
            firstName: name,
            username: `${name}-${suffix}`,
            password: 'x',
            roles: { connect: { id: roleId } },
            ...(branchId && { branch: { connect: { id: branchId } } }),
          },
        })
      ).id;
    ids.userA = await user('sucA', sucursal, ids.branchA);
    ids.userB = await user('sucB', sucursal, ids.branchB);
    ids.recep = await user('recep', recepcion);
    ids.admin = await user('adm', admin);
    ids.taller = await user('taller', taller);

    const order = async (description: string, branchId?: number) =>
      (
        await prisma.order.create({
          data: {
            description,
            clientNameOverride: `Cliente ${description}`,
            creationDate: new Date(),
            area: 'taller',
            requiresDesign: false,
            status: { connect: { id: statusId } },
            user: {
              connect: {
                id:
                  branchId === ids.branchB
                    ? ids.userB
                    : branchId
                      ? ids.userA
                      : ids.recep,
              },
            },
            ...(branchId && { branch: { connect: { id: branchId } } }),
            areaTasks: { create: [{ area: 'taller' }] },
          },
        })
      ).id;
    ids.orderM = await order(`pedido-matriz-${suffix}`);
    ids.orderA = await order(`pedido-A-${suffix}`, ids.branchA);
    ids.orderB = await order(`pedido-B-${suffix}`, ids.branchB);

    const revision = async (orderId: number) => {
      const rev = await prisma.designRevision.create({
        data: {
          orderId,
          round: 1,
          montageFileData: PNG_B64,
          montageFileName: 'montaje.png',
          montageFileMime: 'image/png',
          feedbackFileData: PNG_B64,
          feedbackFileName: 'feedback.png',
          feedbackFileMime: 'image/png',
          files: {
            create: [
              {
                kind: 'montage',
                data: PNG_B64,
                filename: 'm.png',
                mimeType: 'image/png',
              },
            ],
          },
        },
        include: { files: true },
      });
      return rev;
    };
    const revM = await revision(ids.orderM);
    ids.revM = revM.id;
    ids.revFileM = revM.files[0].id;
    ids.revA = (await revision(ids.orderA)).id;

    const mockup = async (orderId: number) =>
      (
        await prisma.orderMockup.create({
          data: {
            orderId,
            garment: 'tshirt',
            imageData: PNG_B64,
            imageMime: 'image/png',
            config: { garment: 'tshirt', colors: {}, layers: [] },
          },
        })
      ).id;
    ids.mockupM = await mockup(ids.orderM);
    ids.mockupA = await mockup(ids.orderA);

    const gatewayStub = {
      notifyNewOrderToArea: jest.fn(),
      notifyNewOrderToAdmin: jest.fn(),
      notifyNewAssignedOrder: jest.fn(),
      notifyOrderStatusChange: jest.fn(),
    } as any;
    // Servicios REALES sobre la base real; sólo el gateway de WebSocket es stub.
    notifications = new NotificationService(
      prisma,
      { notifyUser: jest.fn(), notifyUsers: jest.fn() } as any,
      { notifyUser: jest.fn(), notifyUsers: jest.fn() } as any,
    );
    tasks = new OrderAreaTaskService(prisma, notifications, gatewayStub);
    orders = new OrderService(
      prisma,
      gatewayStub,
      {} as any,
      {} as any,
      notifications,
      { record: jest.fn() } as any,
      tasks,
      {} as any,
    );
    controller = new OrderController(
      orders,
      tasks,
      {} as OrderMaterialItemService,
    );
    mockups = new OrderMockupService(prisma, orders);
  });

  afterAll(async () => {
    if (!prisma) return;
    const orderIds = [ids.orderM, ids.orderA, ids.orderB].filter(Boolean);
    const userIds = [
      ids.userA,
      ids.userB,
      ids.recep,
      ids.admin,
      ids.taller,
    ].filter(Boolean);
    await prisma.notification.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.orderMockup.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.designRevision.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.orderAreaTask.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.branch.deleteMany({
      where: { id: { in: [ids.branchA, ids.branchB].filter(Boolean) } },
    });
    if (createdStatusIds.length) {
      await prisma.status.deleteMany({
        where: { id: { in: createdStatusIds } },
      });
    }
    await prisma.$disconnect();
  });

  describe('GET /orders', () => {
    it('la sucursal A sólo ve el suyo, con cualquier combinación de parámetros', async () => {
      const variants: Partial<OrderListQueryDto>[] = [
        {},
        { page: 1, limit: 50 },
        { branchId: ids.branchB },
        { branchId: ids.branchA },
        { origin: 'matriz' },
        { origin: 'sucursal' },
        { branchId: ids.branchB, origin: 'sucursal' },
        { q: `pedido-matriz-${suffix}` },
        { q: `${ids.orderM}` },
        { q: `#${ids.orderB}` },
        { statusId },
        { from: '2000-01-01', to: '2999-12-31' },
      ];
      for (const v of variants) {
        const result = await orders.findAll(query(v), asBranchA());
        expect(mine(result)).not.toContain(ids.orderM);
        expect(mine(result)).not.toContain(ids.orderB);
        for (const id of mine(result)) expect(id).toBe(ids.orderA);
      }
      expect(mine(await orders.findAll(query(), asBranchA()))).toEqual([
        ids.orderA,
      ]);
      // Los parámetros se ignoran: pedir la otra sucursal no la muestra, y
      // pedir "matriz" no vacía su propio listado.
      expect(
        mine(await orders.findAll(query({ origin: 'matriz' }), asBranchA())),
      ).toEqual([ids.orderA]);
    });

    it('la sucursal B tampoco ve el de A ni el de la matriz', async () => {
      expect(mine(await orders.findAll(query(), asBranchB()))).toEqual([
        ids.orderB,
      ]);
      expect(
        mine(
          await orders.findAll(query({ branchId: ids.branchA }), asBranchB()),
        ),
      ).toEqual([ids.orderB]);
    });

    it('una cuenta de sucursal sin sucursal no ve nada', async () => {
      const orphan = await prisma.user.create({
        data: {
          firstName: 'huerfana',
          username: `huerfana-${suffix}`,
          password: 'x',
          roles: { connect: { name: 'sucursal' } },
        },
      });
      try {
        const result = await orders.findAll(query(), {
          userId: orphan.id,
          roles: ['sucursal'],
        });
        expect(mine(result)).toEqual([]);
      } finally {
        await prisma.user.delete({ where: { id: orphan.id } });
      }
    });

    it('la matriz (Recepción y admin) ve TODOS: matriz y todas las sucursales', async () => {
      for (const who of [asRecep(), asAdmin()]) {
        expect(mine(await orders.findAll(query(), who)).sort()).toEqual(
          [ids.orderM, ids.orderA, ids.orderB].sort(),
        );
      }
    });

    it('filtros de origen para la matriz (AND con q/estado/paginación)', async () => {
      const m = (q: Partial<OrderListQueryDto>) =>
        orders.findAll(query(q), asRecep()).then(mine);
      expect(await m({ origin: 'matriz' })).toEqual([ids.orderM]);
      expect((await m({ origin: 'sucursal' })).sort()).toEqual(
        [ids.orderA, ids.orderB].sort(),
      );
      expect(await m({ branchId: ids.branchB })).toEqual([ids.orderB]);
      expect(await m({ branchId: ids.branchA, origin: 'sucursal' })).toEqual([
        ids.orderA,
      ]);
      // Contradicción => vacío, nunca amplía.
      expect(await m({ branchId: ids.branchA, origin: 'matriz' })).toEqual([]);
      expect(await m({ origin: 'matriz', q: `pedido-A-${suffix}` })).toEqual(
        [],
      );
      expect(await m({ origin: 'sucursal', q: `pedido-A-${suffix}` })).toEqual([
        ids.orderA,
      ]);
      expect(await m({ origin: 'sucursal', statusId })).toContain(ids.orderA);
      const paged: any = await orders.findAll(
        query({ origin: 'sucursal', page: 1, limit: 1 }),
        asRecep(),
      );
      expect(paged.data).toHaveLength(1);
      expect(paged.meta.total).toBeGreaterThanOrEqual(2);
      expect(paged.data[0].branch).toBeTruthy();
    });
  });

  describe('GET /orders/:id y sub-recursos', () => {
    it('detalle: ajeno y de matriz => 403; propio y matriz => ok; inexistente => 404', async () => {
      await expect(
        orders.findOne(ids.orderM, asBranchA()),
      ).rejects.toMatchObject(forbidden);
      await expect(
        orders.findOne(ids.orderB, asBranchA()),
      ).rejects.toMatchObject(forbidden);
      await expect(
        orders.findOne(ids.orderA, asBranchA()),
      ).resolves.toMatchObject({
        id: ids.orderA,
      });
      await expect(
        orders.findOne(2147483000, asBranchA()),
      ).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
      for (const id of [ids.orderM, ids.orderA, ids.orderB]) {
        await expect(orders.findOne(id, asRecep())).resolves.toMatchObject({
          id,
        });
        await expect(orders.findOne(id, asAdmin())).resolves.toMatchObject({
          id,
        });
      }
    });

    it('avance (area-tasks)', async () => {
      const call = (id: number, u: ReturnType<typeof asBranchA>) =>
        controller.getAreaTasks(`${id}`, token(u) as any);
      await expect(call(ids.orderM, asBranchA())).rejects.toMatchObject(
        forbidden,
      );
      await expect(call(ids.orderB, asBranchA())).rejects.toMatchObject(
        forbidden,
      );
      await expect(call(ids.orderA, asBranchA())).resolves.toHaveLength(1);
      await expect(call(ids.orderM, asRecep())).resolves.toHaveLength(1);
    });

    it('hoja de autorización: rondas, montaje, feedback y archivos', async () => {
      const A = asBranchA();
      await expect(
        orders.getDesignRevisions(ids.orderM, A),
      ).rejects.toMatchObject(forbidden);
      await expect(
        orders.getDesignRevisionMontageFile(ids.orderM, ids.revM, A),
      ).rejects.toMatchObject(forbidden);
      await expect(
        orders.getDesignRevisionFeedbackFile(ids.orderM, ids.revM, A),
      ).rejects.toMatchObject(forbidden);
      await expect(
        orders.getDesignRevisionFile(ids.orderM, ids.revM, ids.revFileM, A),
      ).rejects.toMatchObject(forbidden);
      // Truco: pedir una ronda de la matriz bajo el id de SU pedido => 404, no el archivo.
      await expect(
        orders.getDesignRevisionMontageFile(ids.orderA, ids.revM, A),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
      await expect(
        orders.getDesignRevisionFile(ids.orderA, ids.revA, ids.revFileM, A),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
      // Lo propio sí.
      await expect(
        orders.getDesignRevisions(ids.orderA, A),
      ).resolves.toHaveLength(1);
      await expect(
        orders.getDesignRevisionMontageFile(ids.orderA, ids.revA, A),
      ).resolves.toMatchObject({ mimeType: 'image/png' });
      // La matriz ve las dos.
      await expect(
        orders.getDesignRevisions(ids.orderM, asRecep()),
      ).resolves.toHaveLength(1);
      await expect(
        orders.getDesignRevisions(ids.orderA, asRecep()),
      ).resolves.toHaveLength(1);
    });

    it('mockups y order-mockup', async () => {
      const A = asBranchA();
      await expect(mockups.findAll(ids.orderM, A)).rejects.toMatchObject(
        forbidden,
      );
      await expect(mockups.findAll(ids.orderB, A)).rejects.toMatchObject(
        forbidden,
      );
      await expect(
        mockups.findOne(ids.orderM, ids.mockupM, A),
      ).rejects.toMatchObject(forbidden);
      // Mockup de la matriz pedido bajo el id de SU pedido => 404.
      await expect(
        mockups.findOne(ids.orderA, ids.mockupM, A),
      ).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
      await expect(
        mockups.create(
          ids.orderM,
          {
            garment: 'tshirt',
            imageDataUrl: `data:image/png;base64,${PNG_B64}`,
            config: { garment: 'tshirt', colors: {}, layers: [] },
          } as any,
          A,
        ),
      ).rejects.toMatchObject(forbidden);
      await expect(
        mockups.remove(ids.orderM, ids.mockupM, A),
      ).rejects.toMatchObject(forbidden);
      expect(
        await prisma.orderMockup.count({ where: { orderId: ids.orderM } }),
      ).toBe(1);
      await expect(mockups.findAll(ids.orderA, A)).resolves.toHaveLength(1);
      await expect(
        mockups.findAll(ids.orderM, asRecep()),
      ).resolves.toHaveLength(1);
    });
  });

  describe('notificaciones', () => {
    it('lista y contador ocultan avisos de pedidos ajenos (aunque existan en la tabla)', async () => {
      await prisma.notification.createMany({
        data: [
          { userId: ids.userA, type: 'x', title: 'general' },
          {
            userId: ids.userA,
            type: 'x',
            title: 'propio',
            orderId: ids.orderA,
          },
          {
            userId: ids.userA,
            type: 'x',
            title: 'matriz',
            orderId: ids.orderM,
          },
          { userId: ids.userA, type: 'x', title: 'otra', orderId: ids.orderB },
        ],
      });
      const list: any[] = (await notifications.findAllForUser(
        ids.userA,
        undefined,
        ['sucursal'],
      )) as any[];
      expect(list.map((n) => n.title).sort()).toEqual(['general', 'propio']);
      expect(
        (await notifications.unreadCount(ids.userA, ['sucursal'])).unreadCount,
      ).toBe(2);
      // Un usuario de matriz con las mismas filas vería todas (no se filtra).
      expect(
        (await notifications.unreadCount(ids.userA, ['recepcion'])).unreadCount,
      ).toBe(4);
    });

    it('no se crean avisos de pedidos ajenos para una cuenta de sucursal', async () => {
      await prisma.notification.deleteMany({ where: { userId: ids.userA } });
      await notifications.createNotification({
        userId: ids.userA,
        type: 'order_status_changed',
        title: 't',
        orderId: ids.orderM,
      });
      await notifications.createNotificationForUsers([ids.userA, ids.recep], {
        type: 'order_status_changed',
        title: 't',
        orderId: ids.orderB,
      });
      expect(
        await prisma.notification.count({ where: { userId: ids.userA } }),
      ).toBe(0);
      expect(
        await prisma.notification.count({
          where: { userId: ids.recep, orderId: ids.orderB },
        }),
      ).toBe(1);
      // El de su propia sucursal sí le llega.
      await notifications.createNotification({
        userId: ids.userA,
        type: 'order_status_changed',
        title: 't',
        orderId: ids.orderA,
      });
      expect(
        await prisma.notification.count({ where: { userId: ids.userA } }),
      ).toBe(1);
    });
  });
});
