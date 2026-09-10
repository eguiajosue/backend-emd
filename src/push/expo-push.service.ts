import { Injectable, Logger } from '@nestjs/common';
import type { Expo as ExpoType, ExpoPushMessage } from 'expo-server-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { PushNotificationPayload } from './push.service';

/**
 * `expo-server-sdk` es un paquete ESM puro (`"type": "module"`, sin build
 * CJS) y este backend compila a CommonJS: un `import` estático se
 * transpilaría a `require(...)`, que Node rechaza para un paquete ESM
 * (`ERR_REQUIRE_ESM`). El truco de `new Function('return import(...)')`
 * evita que TypeScript reescriba el `import()` dinámico a `require` —
 * Node sí puede hacer `import()` nativo de ESM desde un módulo CJS.
 */
const importExpoModule = new Function(
  'return import("expo-server-sdk")',
) as () => Promise<typeof import('expo-server-sdk')>;

/**
 * Envío de push nativo (iOS/Android) para la futura app Mobile (Expo), en
 * paralelo al Web Push existente (`PushService`). Usa el SDK de Expo: la app
 * Mobile obtiene un "Expo push token" (que Expo resuelve internamente a
 * FCM/APNs) y lo registra acá; nunca hablamos con FCM/APNs directamente.
 */
@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger('ExpoPushService');
  private expoPromise: Promise<{ Expo: typeof ExpoType }> | undefined;

  constructor(private readonly prisma: PrismaService) {}

  private getExpoModule(): Promise<{ Expo: typeof ExpoType }> {
    if (!this.expoPromise) {
      this.expoPromise = importExpoModule();
    }
    return this.expoPromise;
  }

  /** Registra (o reutiliza) el token de push de Expo del usuario logueado. */
  async registerToken(userId: number, token: string) {
    const { Expo } = await this.getExpoModule();
    if (!Expo.isExpoPushToken(token)) {
      throw new Error(`Token de push de Expo inválido: ${token}`);
    }
    return this.prisma.expoPushToken.upsert({
      where: { token },
      create: { userId, token },
      update: { userId },
    });
  }

  /** Borra el token del usuario logueado (ej. al cerrar sesión en el dispositivo). */
  async unregisterToken(userId: number, token: string) {
    await this.prisma.expoPushToken.deleteMany({ where: { userId, token } });
  }

  /** Igual criterio que `PushService.notifyUser`: fire-and-forget, nunca reemplaza el emit de Socket.io. */
  async notifyUser(userId: number, payload: PushNotificationPayload) {
    const tokens = await this.prisma.expoPushToken.findMany({
      where: { userId },
    });
    if (tokens.length === 0) return;
    await this.send(tokens, payload);
  }

  async notifyUsers(userIds: number[], payload: PushNotificationPayload) {
    if (userIds.length === 0) return;
    const tokens = await this.prisma.expoPushToken.findMany({
      where: { userId: { in: userIds } },
    });
    if (tokens.length === 0) return;
    await this.send(tokens, payload);
  }

  private async send(
    tokens: { id: number; token: string }[],
    payload: PushNotificationPayload,
  ) {
    const { Expo } = await this.getExpoModule();
    const expo = new Expo();

    const messages: ExpoPushMessage[] = tokens.map((t) => ({
      to: t.token,
      title: payload.title,
      body: payload.body,
      data: payload.orderId ? { orderId: payload.orderId } : undefined,
      sound: 'default',
    }));

    const chunks = expo.chunkPushNotifications(messages);
    const staleTokenIds: number[] = [];

    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        tickets.forEach((ticket, i) => {
          if (
            ticket.status === 'error' &&
            ticket.details?.error === 'DeviceNotRegistered'
          ) {
            const badToken = chunk[i].to;
            const match = tokens.find((t) => t.token === badToken);
            if (match) staleTokenIds.push(match.id);
          } else if (ticket.status === 'error') {
            this.logger.warn(`Fallo enviando push Expo: ${ticket.message}`);
          }
        });
      } catch (error) {
        this.logger.warn(
          `Fallo enviando chunk de push Expo: ${(error as Error).message}`,
        );
      }
    }

    if (staleTokenIds.length > 0) {
      await this.prisma.expoPushToken
        .deleteMany({ where: { id: { in: staleTokenIds } } })
        .catch(() => undefined);
    }
  }
}
