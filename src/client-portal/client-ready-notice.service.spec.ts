import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from 'src/prisma/prisma.service';
import type { PushService } from 'src/push/push.service';
import {
  ClientReadyNoticeService,
  readyNotifiedAtFor,
} from './client-ready-notice.service';

const send = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send } })),
}));

const TOKEN = 'a'.repeat(43);

function setup(env: Record<string, string> = {}, claimed = 1) {
  const prisma = {
    orderShareLink: {
      findMany: jest.fn().mockResolvedValue([{ id: 7 }]),
      updateMany: jest.fn().mockResolvedValue({ count: claimed }),
      findUnique: jest.fn().mockResolvedValue({
        token: TOKEN,
        pushSubscriptions: [
          { id: 1, endpoint: 'https://push/1', p256dh: 'k', auth: 'a' },
          { id: 2, endpoint: 'https://push/2', p256dh: 'k', auth: 'a' },
        ],
        order: {
          id: 42,
          clientNameOverride: null,
          client: { first_name: 'Ana', email: 'ana@example.com' },
          branch: null,
        },
      }),
    },
    portalPushSubscription: {
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  const push = {
    isEnabled: true,
    send: jest.fn().mockResolvedValueOnce('sent').mockResolvedValueOnce('gone'),
  };
  const config = {
    get: (key: string) =>
      ({ FRONTEND_URL: 'https://app.emd.mx, https://otra.mx', ...env })[key],
  };
  const service = new ClientReadyNoticeService(
    prisma as unknown as PrismaService,
    push as unknown as PushService,
    config as unknown as ConfigService,
  );
  return { service, prisma, push };
}

beforeEach(() => {
  send.mockReset().mockResolvedValue({ data: { id: 'x' }, error: null });
});

describe('ClientReadyNoticeService', () => {
  it('avisa por push con el enlace del portal y borra las suscripciones caducadas', async () => {
    const { service, prisma, push } = setup();
    await service.sendDueNotices();
    expect(prisma.orderShareLink.updateMany).toHaveBeenCalledWith({
      where: { id: 7, readyNotifiedAt: null },
      data: { readyNotifiedAt: expect.any(Date) },
    });
    expect(push.send).toHaveBeenCalledTimes(2);
    expect(push.send.mock.calls[0][1]).toEqual({
      title: 'Tu pedido #42 está listo',
      body: expect.any(String),
      url: `https://app.emd.mx/p/${TOKEN}`,
    });
    expect(prisma.portalPushSubscription.delete).toHaveBeenCalledWith({
      where: { id: 2 },
    });
    // Sin remitente configurado no hay correo.
    expect(send).not.toHaveBeenCalled();
  });

  it('manda correo si hay remitente, API key y email del cliente', async () => {
    const { service } = setup({
      RESEND_API_KEY: 'k',
      CLIENT_EMAIL_FROM: 'EMD <pedidos@emd.mx>',
      CLIENT_PORTAL_URL: 'https://portal.emd.mx/',
    });
    await service.notifyLink(7);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'EMD <pedidos@emd.mx>',
        to: 'ana@example.com',
        subject: 'Tu pedido #42 está listo para entregar',
      }),
    );
    expect(send.mock.calls[0][0].html).toContain(
      `https://portal.emd.mx/p/${TOKEN}`,
    );
  });

  it('si otro proceso ya avisó, no repite', async () => {
    const { service, push } = setup({}, 0);
    await expect(service.notifyLink(7)).resolves.toBe(false);
    expect(push.send).not.toHaveBeenCalled();
  });

  it('suscribir: token inválido es 404 y con push apagado 503', async () => {
    const { service, push } = setup();
    const keys = { p256dh: 'k', auth: 'a' };
    await expect(
      service.subscribe('corto', { endpoint: 'https://x', keys }),
    ).rejects.toMatchObject({ status: 404 });
    push.isEnabled = false;
    await expect(
      service.subscribe(TOKEN, { endpoint: 'https://x', keys }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('el enlace de un pedido listo o entregado nace ya avisado', () => {
    expect(readyNotifiedAtFor('Terminado')).toBeInstanceOf(Date);
    expect(readyNotifiedAtFor('entregado')).toBeInstanceOf(Date);
    expect(readyNotifiedAtFor('autorizado')).toBeNull();
  });
});
