import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { ORDER_VIEWING_ROLES_WITH_BRANCH } from 'src/common/constants/order-viewing-roles';
import { AccessTokenPayload } from 'src/auth/auth.service';
import { CreateOrderMockupDto } from './dto/create-order-mockup.dto';
import { OrderMockupService } from './order-mockup.service';

/**
 * Mockups 3D de un pedido. Leerlos puede cualquiera que vea el detalle del
 * pedido (mismos roles que `GET /orders/:id`, más la visibilidad por área
 * de `assertOrderAccess` en el service). Adjuntarlos y borrarlos, sólo quien
 * arma el pedido con el cliente: Recepción, admin y superuser (y la
 * sucursal, sólo para adjuntar a sus propios pedidos).
 */
@ApiTags('order-mockups')
@Controller('orders/:id/mockups')
export class OrderMockupController {
  constructor(private readonly orderMockupService: OrderMockupService) {}

  @Auth(...ORDER_VIEWING_ROLES_WITH_BRANCH)
  @Get()
  findAll(
    @Param('id', ParseIntPipe) orderId: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderMockupService.findAll(orderId, {
      userId: user.sub,
      roles: user.roles,
    });
  }

  @Auth(...ORDER_VIEWING_ROLES_WITH_BRANCH)
  @Get(':mockupId')
  findOne(
    @Param('id', ParseIntPipe) orderId: number,
    @Param('mockupId', ParseIntPipe) mockupId: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderMockupService.findOne(orderId, mockupId, {
      userId: user.sub,
      roles: user.roles,
    });
  }

  // Sube una imagen de hasta 8MB: throttle más estricto que el default
  // global, igual que las demás subidas de archivos del pedido.
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  // La sucursal adjunta mockups a SUS pedidos (assertOrderAccess).
  @Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER, Role.SUCURSAL)
  @Post()
  create(
    @Param('id', ParseIntPipe) orderId: number,
    @Body() dto: CreateOrderMockupDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderMockupService.create(orderId, dto, {
      userId: user.sub,
      roles: user.roles,
    });
  }

  @Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':mockupId')
  remove(
    @Param('id', ParseIntPipe) orderId: number,
    @Param('mockupId', ParseIntPipe) mockupId: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderMockupService.remove(orderId, mockupId, {
      userId: user.sub,
      roles: user.roles,
    });
  }
}
