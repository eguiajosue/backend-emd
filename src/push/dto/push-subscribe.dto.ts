import { IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { IsPushServiceEndpoint } from '../push-endpoint';

export class PushKeysDto {
  @IsString()
  @MaxLength(200)
  p256dh: string;

  @IsString()
  @MaxLength(100)
  auth: string;
}

/**
 * Body de `POST /push/subscribe`: la suscripción que devuelve
 * `pushManager.subscribe()` en el navegador.
 */
export class PushSubscribeDto {
  @IsString()
  @MaxLength(1000)
  @IsPushServiceEndpoint()
  endpoint: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;
}
