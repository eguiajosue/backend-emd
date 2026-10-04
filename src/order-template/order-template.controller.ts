import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';
import { OrderTemplateService } from './order-template.service';
import {
  CreateOrderTemplateDto,
  UpdateOrderTemplateDto,
} from './dto/order-template.dto';

/**
 * Plantillas de pedido por cliente. Sólo las ve y las administra quien da
 * de alta pedidos: Recepción, admin y superuser.
 */
@ApiTags('order-templates')
@Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
@Controller()
export class OrderTemplateController {
  constructor(private readonly orderTemplateService: OrderTemplateService) {}

  @Get('clients/:clientId/order-templates')
  findByClient(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.orderTemplateService.findByClient(clientId);
  }

  @Post('clients/:clientId/order-templates')
  create(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Body() dto: CreateOrderTemplateDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderTemplateService.create(clientId, dto, user.sub);
  }

  @Get('order-templates/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.orderTemplateService.findOne(id);
  }

  @Patch('order-templates/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderTemplateDto,
  ) {
    return this.orderTemplateService.update(id, dto);
  }

  @Delete('order-templates/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.orderTemplateService.remove(id);
  }

  @Post('order-templates/:id/use')
  markUsed(@Param('id', ParseIntPipe) id: number) {
    return this.orderTemplateService.markUsed(id);
  }
}
