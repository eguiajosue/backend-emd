import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import type { AccessTokenPayload } from 'src/auth/auth.service';
import { ClientPortalService } from './client-portal.service';
import { ClientReadyNoticeService } from './client-ready-notice.service';
import {
  ClientPortalRespondDto,
  PortalPushSubscribeDto,
  PortalPushUnsubscribeDto,
} from './dto/client-portal.dto';

/**
 * Lo que ve el CLIENTE con su enlace privado. Público (sin sesión): el token
 * de 32 bytes es la llave. Throttle propio para que no se pueda adivinar a
 * fuerza bruta ni martillar la base.
 */
@ApiTags('portal')
@Controller('portal')
export class ClientPortalController {
  constructor(
    private readonly portal: ClientPortalService,
    private readonly readyNotice: ClientReadyNoticeService,
  ) {}

  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Get(':token')
  @ApiOperation({ summary: 'El pedido visto por el cliente (enlace privado)' })
  get(@Param('token') token: string) {
    return this.portal.getPortal(token);
  }

  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Get(':token/design-files/:fileId')
  designFile(
    @Param('token') token: string,
    @Param('fileId', ParseIntPipe) fileId: number,
  ) {
    return this.portal.getDesignFile(token, fileId);
  }

  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Get(':token/mockups/:mockupId')
  mockup(
    @Param('token') token: string,
    @Param('mockupId', ParseIntPipe) mockupId: number,
  ) {
    return this.portal.getMockupImage(token, mockupId);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(':token/respond')
  @ApiOperation({ summary: 'El cliente aprueba el diseño o pide cambios' })
  respond(@Param('token') token: string, @Body() dto: ClientPortalRespondDto) {
    return this.portal.respond(token, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(':token/push')
  @ApiOperation({
    summary: 'El cliente pide aviso cuando su pedido esté listo',
  })
  subscribePush(
    @Param('token') token: string,
    @Body() dto: PortalPushSubscribeDto,
  ) {
    return this.readyNotice.subscribe(token, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Delete(':token/push')
  unsubscribePush(
    @Param('token') token: string,
    @Body() dto: PortalPushUnsubscribeDto,
  ) {
    return this.readyNotice.unsubscribe(token, dto.endpoint);
  }
}

/** Recepción comparte el enlace y resuelve lo que respondió el cliente. */
@ApiTags('portal')
@Controller('orders')
export class ClientPortalStaffController {
  constructor(private readonly portal: ClientPortalService) {}

  @Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
  @Get(':id/share-link')
  state(@Param('id', ParseIntPipe) id: number) {
    return this.portal.getShareState(id);
  }

  @Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
  @Post(':id/share-link')
  create(
    @Param('id', ParseIntPipe) id: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.portal.ensureLink(id, user.sub);
  }

  @Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
  @Post(':id/share-link/regenerate')
  regenerate(
    @Param('id', ParseIntPipe) id: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.portal.regenerateLink(id, user.sub);
  }

  @Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
  @Delete(':id/share-link')
  revoke(@Param('id', ParseIntPipe) id: number) {
    return this.portal.revokeLink(id);
  }

  @Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
  @Post(':id/client-responses/:responseId/discard')
  discard(
    @Param('id', ParseIntPipe) id: number,
    @Param('responseId', ParseIntPipe) responseId: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.portal.discardResponse(id, responseId, user.sub);
  }
}
