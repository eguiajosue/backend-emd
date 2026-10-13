import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { AccessTokenPayload } from 'src/auth/auth.service';
import { ORDER_VIEWING_ROLES_WITH_BRANCH } from 'src/common/constants/order-viewing-roles';
import {
  CompleteProductionUploadDto,
  InitProductionUploadDto,
  SignProductionPartsDto,
} from './production-file.dto';
import {
  PRODUCTION_FILE_WRITER_ROLES,
  ProductionFileService,
} from './production-file.service';

const who = (user: AccessTokenPayload) => ({
  userId: user.sub,
  roles: user.roles,
});

/**
 * Archivos finales de producción de un pedido. Diseño los sube directo al
 * bucket (multipart con URLs firmadas); producción los descarga. El backend
 * nunca recibe los bytes.
 */
@ApiTags('orders')
@Controller('orders/:orderId/production-files')
export class ProductionFileController {
  constructor(private readonly service: ProductionFileService) {}

  @Auth(...ORDER_VIEWING_ROLES_WITH_BRANCH)
  @Get()
  list(
    @Param('orderId', ParseIntPipe) orderId: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.service.list(orderId, who(user));
  }

  @Auth(...PRODUCTION_FILE_WRITER_ROLES)
  @Post('uploads')
  init(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: InitProductionUploadDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.service.initUpload(orderId, dto, who(user));
  }

  @Auth(...PRODUCTION_FILE_WRITER_ROLES)
  @Post('uploads/:fileId/parts')
  signParts(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Body() dto: SignProductionPartsDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.service.signPartsFor(
      orderId,
      fileId,
      dto.partNumbers,
      who(user),
    );
  }

  @Auth(...PRODUCTION_FILE_WRITER_ROLES)
  @Post('uploads/:fileId/complete')
  complete(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Body() dto: CompleteProductionUploadDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.service.completeUpload(orderId, fileId, dto, who(user));
  }

  @Auth(...PRODUCTION_FILE_WRITER_ROLES)
  @Delete('uploads/:fileId')
  abort(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.service.abortUpload(orderId, fileId, who(user));
  }

  @Auth(...ORDER_VIEWING_ROLES_WITH_BRANCH)
  @Get(':fileId/download')
  download(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.service.getDownloadUrl(orderId, fileId, who(user));
  }

  @Auth(...PRODUCTION_FILE_WRITER_ROLES)
  @Delete(':fileId')
  remove(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.service.remove(orderId, fileId, who(user));
  }
}
