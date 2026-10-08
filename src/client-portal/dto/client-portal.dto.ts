import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
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
