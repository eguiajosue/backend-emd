import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { ClientListQueryDto } from './dto/client-list-query.dto';
import { ClientService } from './client.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';
import { OrderService } from 'src/order/order.service';

@ApiTags('clients')
@Controller('clients')
export class ClientController {
  constructor(
    private readonly clientService: ClientService,
    private readonly orderService: OrderService,
  ) {}

  // La sucursal también registra clientes nuevos al levantar un pedido.
  @Auth(Role.RECEPCION, Role.SUCURSAL)
  @Post()
  create(
    @Body() createClientDto: CreateClientDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    // La sucursal crea clientes SUYOS (branchId lo fija el servidor).
    return this.clientService.create(createClientDto, {
      userId: user.sub,
      roles: user.roles,
    });
  }

  // Lectura abierta a todos los roles que pueden ver pedidos: la pantalla de
  // "Pedidos" (incluidos los roles operativos) necesita el listado de
  // clientes para el filtro y para mostrar el nombre del cliente.
  @Auth(
    Role.RECEPCION,
    Role.ADMIN,
    Role.SUPERUSER,
    Role.TALLER,
    Role.DTF,
    Role.BORDADO,
    Role.DISENO,
    Role.LASER,
    Role.IMPRESIONES,
    // Alta de pedidos desde la sucursal: elige cliente.
    Role.SUCURSAL,
  )
  @Get()
  findAll(
    @Query() query: ClientListQueryDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.clientService.findAll(query, {
      userId: user.sub,
      roles: user.roles,
    });
  }

  @Auth(
    Role.RECEPCION,
    Role.ADMIN,
    Role.SUPERUSER,
    Role.TALLER,
    Role.DTF,
    Role.BORDADO,
    Role.DISENO,
    Role.LASER,
    Role.IMPRESIONES,
    // Alta de pedidos desde la sucursal: elige cliente.
    Role.SUCURSAL,
  )
  @Get(':id')
  findOne(@Param('id') id: string, @ActiveUser() user: AccessTokenPayload) {
    return this.clientService.findOne(+id, {
      userId: user.sub,
      roles: user.roles,
    });
  }

  // La sucursal edita sólo SUS clientes (el service responde 403 si es ajeno).
  @Auth(Role.RECEPCION, Role.SUCURSAL)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.clientService.update(+id, updateClientDto, {
      userId: user.sub,
      roles: user.roles,
    });
  }

  // Borrar clientes es sólo de la matriz (la sucursal no puede: 403).
  @Auth(Role.RECEPCION)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.clientService.remove(+id);
  }

  @Auth(
    Role.RECEPCION,
    Role.ADMIN,
    Role.SUPERUSER,
    Role.TALLER,
    Role.DTF,
    Role.BORDADO,
    Role.DISENO,
    Role.LASER,
    Role.IMPRESIONES,
  )
  @Get(':id/orders')
  findOrders(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderService.findAllByClient(+id, query, {
      userId: user.sub,
      roles: user.roles,
    });
  }
}
