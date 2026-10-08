import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Resend } from 'resend';
import { PrismaService } from 'src/prisma/prisma.service';
import { PushService, type SubscribeInput } from 'src/push/push.service';
import {
  STATUS_NAME_ENTREGADO,
  STATUS_NAME_TERMINADO,
} from 'src/order/status-id-resolver';

/**
 * Aviso al cliente cuando su pedido está "Listo para entregar" (WORKFLOW.md §8).
 *
 * Cada minuto busca enlaces del portal cuyo pedido ya está terminado y que
 * todavía no avisaron (`readyNotifiedAt` null), y manda:
 *  - Web Push a los navegadores que pidieron "Avísame cuando esté listo";
 *  - correo, si el cliente tiene email y hay remitente (`CLIENT_EMAIL_FROM`).
 *
 * Mirar el estado (y no engancharse a cada camino que termina un pedido)
 * cubre igual el cierre por áreas que el cambio manual. Un solo aviso por
 * pedido: si regresa a producción y vuelve a quedar listo, no se repite. Con
 * varias instancias, el `updateMany` condicional decide quién avisa.
 */
@Injectable()
export class ClientReadyNoticeService {
  private readonly logger = new Logger(ClientReadyNoticeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Suscripción desde el portal
  // ---------------------------------------------------------------------------

  private async linkIdFor(token: string) {
    if (!token || token.length < 20 || token.length > 100) this.notFound();
    const link = await this.prisma.orderShareLink.findUnique({
      where: { token },
      select: { id: true },
    });
    if (!link) this.notFound();
    return link!.id;
  }

  private notFound(): never {
    throw new HttpException(
      'Este enlace no existe o ya no está disponible',
      HttpStatus.NOT_FOUND,
    );
  }

  async subscribe(token: string, input: SubscribeInput) {
    if (!this.push.isEnabled) {
      throw new HttpException(
        'Los avisos no están disponibles por ahora',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const linkId = await this.linkIdFor(token);
    // Un enlace no junta suscripciones sin fin (cada una es un envío).
    const count = await this.prisma.portalPushSubscription.count({
      where: { linkId },
    });
    const exists = await this.prisma.portalPushSubscription.findUnique({
      where: { linkId_endpoint: { linkId, endpoint: input.endpoint } },
      select: { id: true },
    });
    if (!exists && count >= 10) {
      throw new HttpException(
        'Ya hay demasiados dispositivos con avisos para este pedido',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.portalPushSubscription.upsert({
      where: { linkId_endpoint: { linkId, endpoint: input.endpoint } },
      create: {
        linkId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
      update: { p256dh: input.keys.p256dh, auth: input.keys.auth },
    });
    return { subscribed: true };
  }

  async unsubscribe(token: string, endpoint: string) {
    const linkId = await this.linkIdFor(token);
    await this.prisma.portalPushSubscription.deleteMany({
      where: { linkId, endpoint },
    });
    return { subscribed: false };
  }

  // ---------------------------------------------------------------------------
  // El aviso
  // ---------------------------------------------------------------------------

  @Cron(CronExpression.EVERY_MINUTE)
  async sendDueNotices() {
    const due = await this.prisma.orderShareLink.findMany({
      where: {
        readyNotifiedAt: null,
        order: {
          status: {
            name: { equals: STATUS_NAME_TERMINADO, mode: 'insensitive' },
          },
        },
      },
      select: { id: true },
      take: 50,
    });
    for (const { id } of due) {
      try {
        await this.notifyLink(id);
      } catch (error) {
        this.logger.error(
          `No se pudo avisar al cliente (enlace ${id}): ${(error as Error).message}`,
        );
      }
    }
  }

  /** Avisa por un enlace; `false` si otro proceso ya lo había hecho. */
  async notifyLink(linkId: number): Promise<boolean> {
    const { count } = await this.prisma.orderShareLink.updateMany({
      where: { id: linkId, readyNotifiedAt: null },
      data: { readyNotifiedAt: new Date() },
    });
    if (count !== 1) return false;

    const link = await this.prisma.orderShareLink.findUnique({
      where: { id: linkId },
      select: {
        token: true,
        pushSubscriptions: true,
        order: {
          select: {
            id: true,
            clientNameOverride: true,
            client: { select: { first_name: true, email: true } },
            branch: { select: { name: true } },
          },
        },
      },
    });
    if (!link) return false;
    const { order } = link;
    const url = this.portalUrl(link.token);
    const title = `Tu pedido #${order.id} está listo`;
    const body = 'Ya puedes pasar a recogerlo. Toca para ver los detalles.';

    let pushed = 0;
    for (const sub of link.pushSubscriptions) {
      const result = await this.push.send(sub, { title, body, url });
      if (result === 'sent') pushed++;
      if (result === 'gone') {
        await this.prisma.portalPushSubscription
          .delete({ where: { id: sub.id } })
          .catch(() => undefined);
      }
    }

    const emailed = await this.sendEmail({
      to: order.client?.email ?? null,
      name: order.client?.first_name ?? order.clientNameOverride ?? null,
      orderId: order.id,
      branchName: order.branch?.name ?? null,
      url,
    });
    this.logger.log(
      `Pedido #${order.id} listo: aviso al cliente (push ${pushed}, correo ${emailed ? 'sí' : 'no'})`,
    );
    return true;
  }

  /** `CLIENT_PORTAL_URL` o el primer origen de `FRONTEND_URL`. */
  private portalUrl(token: string) {
    const base =
      this.config.get<string>('CLIENT_PORTAL_URL') ??
      (this.config.get<string>('FRONTEND_URL') ?? '').split(',')[0].trim();
    return `${base.replace(/\/+$/, '')}/p/${token}`;
  }

  private async sendEmail(input: {
    to: string | null;
    name: string | null;
    orderId: number;
    branchName: string | null;
    url: string;
  }): Promise<boolean> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const from = this.config.get<string>('CLIENT_EMAIL_FROM');
    const to = input.to?.trim();
    if (!apiKey || !from || !to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return false;
    }
    const greeting = input.name ? `Hola ${input.name},` : 'Hola,';
    const where = input.branchName
      ? `en ${input.branchName}`
      : 'en nuestro mostrador';
    try {
      const result = await new Resend(apiKey).emails.send({
        from,
        to,
        subject: `Tu pedido #${input.orderId} está listo para entregar`,
        text: `${greeting}\n\nTu pedido #${input.orderId} ya está listo. Puedes pasar a recogerlo ${where}.\n\nVer tu pedido: ${input.url}\n\nEMD Bordados`,
        html: readyEmailHtml({ ...input, greeting, where }),
      });
      if (result.error) {
        this.logger.warn(
          `Resend rechazó el aviso del pedido #${input.orderId}: ${result.error.message}`,
        );
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `No se pudo mandar el correo del pedido #${input.orderId}: ${(error as Error).message}`,
      );
      return false;
    }
  }
}

/** Ya avisado (o no aplica): al crear el enlace de un pedido listo o entregado. */
export function readyNotifiedAtFor(statusName: string): Date | null {
  const name = statusName.toLowerCase();
  return name === STATUS_NAME_TERMINADO || name === STATUS_NAME_ENTREGADO
    ? new Date()
    : null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readyEmailHtml(input: {
  greeting: string;
  where: string;
  orderId: number;
  url: string;
}) {
  const url = escapeHtml(input.url);
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f4f5;padding:24px">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden">
    <div style="background:#111827;color:#ffffff;padding:20px 24px;font-weight:bold;letter-spacing:.04em">EMD BORDADOS</div>
    <div style="padding:24px;color:#111827;font-size:15px;line-height:1.5">
      <p style="margin:0 0 12px">${escapeHtml(input.greeting)}</p>
      <p style="margin:0 0 12px"><strong>Tu pedido #${input.orderId} ya está listo.</strong> Puedes pasar a recogerlo ${escapeHtml(input.where)}.</p>
      <p style="margin:24px 0"><a href="${url}" style="background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block">Ver mi pedido</a></p>
      <p style="margin:0;color:#6b7280;font-size:13px">Si el botón no abre, copia este enlace: ${url}</p>
    </div>
  </div>
</div>`;
}
