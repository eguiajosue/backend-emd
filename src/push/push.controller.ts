import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PushService, SubscribeInput } from './push.service';
import { ExpoPushService } from './expo-push.service';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';

const STAFF_ROLES = [
  Role.ADMIN,
  Role.RECEPCION,
  Role.SUPERUSER,
  Role.TALLER,
  Role.DTF,
  Role.BORDADO,
  Role.DISENO,
  Role.LASER,
  Role.IMPRESIONES,
] as const;

@ApiTags('push')
@Controller('push')
export class PushController {
  constructor(
    private readonly pushService: PushService,
    private readonly expoPushService: ExpoPushService,
  ) {}

  /**
   * Sin @Auth: sólo devuelve la clave pública VAPID, que no es secreta (viaja
   * igual al navegador dentro de `pushManager.subscribe`). Simplifica
   * `subscribeToPush()` en el frontend, que la necesita antes de tener
   * garantizado un token válido en memoria.
   */
  @Get('vapid-public-key')
  getVapidPublicKey() {
    return { publicKey: this.pushService.publicKey ?? null };
  }

  @Auth(
    Role.ADMIN,
    Role.RECEPCION,
    Role.SUPERUSER,
    Role.TALLER,
    Role.DTF,
    Role.BORDADO,
    Role.DISENO,
    Role.LASER,
    Role.IMPRESIONES,
  )
  @Post('subscribe')
  subscribe(
    @Body() body: SubscribeInput,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.pushService.subscribe(user.sub, body);
  }

  @Auth(
    Role.ADMIN,
    Role.RECEPCION,
    Role.SUPERUSER,
    Role.TALLER,
    Role.DTF,
    Role.BORDADO,
    Role.DISENO,
    Role.LASER,
    Role.IMPRESIONES,
  )
  @Delete('subscribe')
  async unsubscribe(
    @ActiveUser() user: AccessTokenPayload,
    @Body('endpoint') bodyEndpoint: string | undefined,
    @Query('endpoint') queryEndpoint: string | undefined,
  ) {
    const endpoint = bodyEndpoint ?? queryEndpoint;
    if (endpoint) {
      await this.pushService.unsubscribe(user.sub, endpoint);
    }
    return { message: 'Suscripción eliminada' };
  }

  /** Registra (o reutiliza) el Expo push token del dispositivo Mobile logueado. */
  @Auth(...STAFF_ROLES)
  @Post('expo-token')
  registerExpoToken(
    @Body('token') token: string,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.expoPushService.registerToken(user.sub, token);
  }

  /** Borra el Expo push token (ej. al cerrar sesión en el dispositivo). */
  @Auth(...STAFF_ROLES)
  @Delete('expo-token')
  async unregisterExpoToken(
    @ActiveUser() user: AccessTokenPayload,
    @Body('token') bodyToken: string | undefined,
    @Query('token') queryToken: string | undefined,
  ) {
    const token = bodyToken ?? queryToken;
    if (token) {
      await this.expoPushService.unregisterToken(user.sub, token);
    }
    return { message: 'Token eliminado' };
  }
}
