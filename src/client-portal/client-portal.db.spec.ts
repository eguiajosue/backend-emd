import { HttpException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { NotificationService } from 'src/notification/notification.service';
import type { StorageService } from 'src/storage/storage.service';
import { ClientPortalService } from './client-portal.service';

/**
 * Portal del cliente contra Postgres real (sin mocks de Prisma): que los
 * `select` y las relaciones nuevas existan de verdad y que el flujo enlace →
 * vista → respuesta → descarte deje la base como se espera.
 *
 * Sólo corre si hay una base de pruebas migrada a HEAD y descartable:
 *   PORTAL_TEST_DATABASE_URL="postgresql://postgres@localhost:5499/<db>?host=/tmp" npx jest client-portal.db
 */
const URL = process.env.PORTAL_TEST_DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

const STATUS_NAMES = ['esperando autorización', 'entregado', 'autorizado'];

describeDb('Portal del cliente en Postgres', () => {
  let prisma: PrismaService;
  let service: ClientPortalService;
  let notify: jest.Mock;
  let userId: number;
  const orderIds: number[] = [];
  const createdStatusIds: number[] = [];
  const statusIds: Record<string, number> = {};

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    prisma = new PrismaService();
    await prisma.$connect();
    userId = (
      await prisma.user.create({
        data: {
          firstName: 'Rita',
          username: `portal-${Date.now()}`,
          password: 'x',
        },
      })
    ).id;
    for (const name of STATUS_NAMES) {
      const existing = await prisma.status.findUnique({ where: { name } });
      const status =
        existing ?? (await prisma.status.create({ data: { name } }));
      if (!existing) createdStatusIds.push(status.id);
      statusIds[name] = status.id;
    }
    notify = jest.fn().mockResolvedValue(undefined);
    service = new ClientPortalService(
      prisma,
      {
        loadBase64OrNull: jest.fn().mockResolvedValue(null),
        toDataUrl: jest.fn(async (mime: string) => `data:${mime};base64,AAAA`),
      } as unknown as StorageService,
      { createNotification: notify } as unknown as NotificationService,
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.orderHistory.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.orderProduct.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => 0);
    await prisma.status
      .deleteMany({ where: { id: { in: createdStatusIds } } })
      .catch(() => 0);
    await prisma.$disconnect();
  });

  async function orderAwaitingApproval() {
    const order = await prisma.order.create({
      data: {
        description: 'Gorras con logo',
        clientNameOverride: 'Cafetería Luna',
        creationDate: new Date(),
        deliveryDate: new Date(Date.now() + 5 * 86_400_000),
        userId,
        statusId: statusIds['esperando autorización'],
        requiresDesign: true,
        area: 'diseno',
        orderProducts: {
          create: [
            {
              customName: 'Gorra',
              quantity: 12,
              sizes: { general: { U: 12 } },
            },
          ],
        },
        designRevisions: {
          create: {
            round: 1,
            sentAt: new Date(),
            sentByUserId: userId,
            files: {
              create: [
                {
                  kind: 'montage',
                  filename: 'montaje.png',
                  mimeType: 'image/png',
                  data: 'AAAA',
                },
              ],
            },
          },
        },
      },
      include: { designRevisions: { include: { files: true } } },
    });
    orderIds.push(order.id);
    return order;
  }

  const statusOf = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return 200;
    } catch (e) {
      return (e as HttpException).getStatus();
    }
  };

  it('enlace → vista → respuesta → descarte', async () => {
    const order = await orderAwaitingApproval();
    const first = await service.ensureLink(order.id, userId);
    const again = await service.ensureLink(order.id, userId);
    expect(again.link!.token).toBe(first.link!.token);
    const token = first.link!.token;
    expect(token.length).toBeGreaterThanOrEqual(40);

    const view = await service.getPortal(token);
    expect(view.order).toMatchObject({
      id: order.id,
      clientName: 'Cafetería Luna',
    });
    expect(view.stage.key).toBe('autorizacion');
    expect(view.stages.map((s) => s.key)).toEqual([
      'diseno',
      'autorizacion',
      'produccion',
      'listo',
      'entregado',
    ]);
    expect(view.products).toEqual([
      { name: 'Gorra', quantity: 12, sizes: { general: { U: 12 } } },
    ]);
    expect(view.design).toMatchObject({ round: 1, awaitingResponse: true });
    expect(view.design!.files.map((f) => f.filename)).toEqual(['montaje.png']);

    const fileId = order.designRevisions[0].files[0].id;
    await expect(service.getDesignFile(token, fileId)).resolves.toMatchObject({
      filename: 'montaje.png',
    });

    const state = await service.getShareState(order.id);
    expect(state.link!.viewCount).toBe(1);
    expect(state.link!.lastViewedAt).not.toBeNull();

    // 'cambios' sin comentario no pasa; con comentario queda pendiente y avisa.
    expect(
      await statusOf(() => service.respond(token, { kind: 'cambios' })),
    ).toBe(400);
    await service.respond(token, {
      kind: 'cambios',
      comment: 'Más grande el logo',
    });
    const { response } = await service.respond(token, { kind: 'aprobar' });
    const all = await prisma.clientDesignResponse.findMany({
      where: { orderId: order.id },
      orderBy: { id: 'asc' },
    });
    expect(all.map((r) => [r.kind, r.status])).toEqual([
      ['cambios', 'reemplazada'],
      ['aprobar', 'pendiente'],
    ]);
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userId,
        type: 'client_portal_response',
        orderId: order.id,
      }),
    );
    expect(
      (await service.getShareState(order.id)).pendingResponse,
    ).toMatchObject({ id: response.id, kind: 'aprobar' });

    await service.discardResponse(order.id, response.id, userId);
    expect((await service.getShareState(order.id)).pendingResponse).toBeNull();
    expect(
      await statusOf(() =>
        service.discardResponse(order.id, response.id, userId),
      ),
    ).toBe(409);
  });

  it('regenerar invalida el enlace anterior y revocar lo apaga', async () => {
    const order = await orderAwaitingApproval();
    const { link } = await service.ensureLink(order.id, userId);
    const { link: fresh } = await service.regenerateLink(order.id, userId);
    expect(fresh!.token).not.toBe(link!.token);
    expect(await statusOf(() => service.getPortal(link!.token))).toBe(404);
    await expect(service.getPortal(fresh!.token)).resolves.toBeDefined();
    await service.revokeLink(order.id);
    expect(await statusOf(() => service.getPortal(fresh!.token))).toBe(404);
  });

  it('el diseño ya respondido no acepta otra respuesta', async () => {
    const order = await orderAwaitingApproval();
    const { link } = await service.ensureLink(order.id, userId);
    await prisma.designRevision.update({
      where: { id: order.designRevisions[0].id },
      data: { approved: true, approvedAt: new Date() },
    });
    await prisma.order.update({
      where: { id: order.id },
      data: { statusId: statusIds['autorizado'], area: 'bordado' },
    });
    const view = await service.getPortal(link!.token);
    expect(view.stage.key).toBe('produccion');
    expect(view.design!.awaitingResponse).toBe(false);
    expect(
      await statusOf(() => service.respond(link!.token, { kind: 'aprobar' })),
    ).toBe(409);
  });

  it('vence 30 días después de la entrega', async () => {
    const order = await orderAwaitingApproval();
    const { link } = await service.ensureLink(order.id, userId);
    await prisma.order.update({
      where: { id: order.id },
      data: { statusId: statusIds['entregado'] },
    });
    await prisma.orderHistory.create({
      data: {
        orderId: order.id,
        previousStatusId: statusIds['autorizado'],
        newStatusId: statusIds['entregado'],
        changeDate: new Date(Date.now() - 10 * 86_400_000),
      },
    });
    expect((await service.getPortal(link!.token)).stage.key).toBe('entregado');
    await prisma.orderHistory.updateMany({
      where: { orderId: order.id },
      data: { changeDate: new Date(Date.now() - 31 * 86_400_000) },
    });
    expect(await statusOf(() => service.getPortal(link!.token))).toBe(410);
  });

  it('tokens mal formados son 404 sin tocar la base', async () => {
    expect(await statusOf(() => service.getPortal('corto'))).toBe(404);
  });
});
