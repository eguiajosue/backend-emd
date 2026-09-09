import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

/** Datos que manda el navegador al suscribirse (`PushSubscriptionJSON`). */
export interface SubscribeInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/** Payload que viaja dentro del push, lo recibe `sw.ts` en el evento `push`. */
export interface PushNotificationPayload {
  title: string;
  body?: string;
  orderId?: number;
}

/**
 * Envío de Web Push real (además del Socket.io en vivo existente), usando el
 * mismo par de claves VAPID para todas las suscripciones de la app.
 *
 * Sin `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` configuradas, el envío queda
 * deshabilitado en silencio (no rompe el resto del flujo de notificaciones,
 * que sigue funcionando por Socket.io).
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger('PushService');
  private readonly enabled: boolean;
  readonly publicKey: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.publicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');
    const subject =
      this.configService.get<string>('VAPID_SUBJECT') ??
      'mailto:soporte@emdbordados.com';

    this.enabled = Boolean(this.publicKey && privateKey);
    if (this.enabled) {
      webpush.setVapidDetails(subject, this.publicKey!, privateKey!);
    } else {
      this.logger.warn(
        'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no configuradas: Web Push deshabilitado',
      );
    }
  }

  /** Crea o actualiza (por `endpoint`) la suscripción del usuario logueado. */
  async subscribe(userId: number, input: SubscribeInput) {
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
      update: {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
    });
  }

  /** Borra la suscripción del usuario logueado (sólo la propia: filtra por userId también). */
  async unsubscribe(userId: number, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
  }

  /**
   * Manda un push a todas las suscripciones activas de un usuario. Se usa
   * como paso adicional al emit de Socket.io existente, nunca en su
   * reemplazo (el usuario puede no tener el navegador abierto).
   *
   * // TODO Fase 4: respetar notificationsMuted / filtros de preferencias
   * del usuario antes de enviar (campos que agrega otro trabajo en paralelo).
   */
  async notifyUser(userId: number, payload: PushNotificationPayload) {
    if (!this.enabled) return;

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    if (subscriptions.length === 0) return;

    const body = JSON.stringify(payload);

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            body,
          );
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // Suscripción caducada/revocada por el navegador: se borra para
            // no seguir intentando en cada notificación futura.
            await this.prisma.pushSubscription
              .delete({ where: { id: subscription.id } })
              .catch(() => undefined);
          } else {
            this.logger.warn(
              `Fallo enviando push a la suscripción ${subscription.id}: ${
                (error as Error).message
              }`,
            );
          }
        }
      }),
    );
  }

  /**
   * Igual que `notifyUser`, para varios destinatarios a la vez (mismo
   * criterio que `NotificationService.createNotificationForUsers`).
   */
  async notifyUsers(userIds: number[], payload: PushNotificationPayload) {
    if (!this.enabled || userIds.length === 0) return;
    await Promise.all(
      userIds.map((userId) => this.notifyUser(userId, payload)),
    );
  }
}
