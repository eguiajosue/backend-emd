import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TrimString } from 'src/common/transformers/empty-to-undefined';
import { CLIENT_RESPONSE_KINDS } from '../client-portal.service';

/** Body de `POST /portal/:token/respond`: el cliente aprueba o pide cambios. */
export class ClientPortalRespondDto {
  @IsIn(CLIENT_RESPONSE_KINDS, {
    message: 'La respuesta debe ser aprobar o cambios',
  })
  kind: (typeof CLIENT_RESPONSE_KINDS)[number];

  // Obligatorio en 'cambios' (lo valida el servicio, con su mensaje).
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

class PortalPushKeysDto {
  @IsString()
  @MaxLength(200)
  p256dh: string;

  @IsString()
  @MaxLength(100)
  auth: string;
}

/** Body de `POST /portal/:token/push`: la suscripción del navegador del cliente. */
export class PortalPushSubscribeDto {
  @IsString()
  @MaxLength(1000)
  @Matches(/^https:\/\//, { message: 'Suscripción inválida' })
  endpoint: string;

  @ValidateNested()
  @Type(() => PortalPushKeysDto)
  keys: PortalPushKeysDto;
}

/** Body de `DELETE /portal/:token/push`. */
export class PortalPushUnsubscribeDto {
  @IsString()
  @MaxLength(1000)
  endpoint: string;
}
