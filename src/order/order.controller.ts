import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { CreateOrderNoteDto } from './dto/create-order-note.dto';
import {
  CreateDesignRevisionDto,
  AddDesignFeedbackDto,
  ApproveDesignRevisionDto,
} from './dto/design-revision.dto';
import { OrderExportQueryDto } from './dto/order-export-query.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';
import { toCsv } from 'src/common/utils/csv';

@ApiTags('orders')
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Auth(Role.RECEPCION)
  @Post()
  create(
    @Body() createOrderDto: CreateOrderDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    // userId (creador del pedido) lo determina el servidor a partir del
    // token, nunca el cliente -- evita depender de que el frontend arme
    // ese valor correctamente y evita que se pueda falsear.
    return this.orderService.create({ ...createOrderDto, userId: user.sub });
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
  @Get()
  findAll(
    @Query() query: PaginationQueryDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderService.findAll(query, {
      userId: user.sub,
      roles: user.roles,
    });
  }

  // Definido antes de ':id' para que 'history' no sea interpretado como un id.
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
  @Get('history')
  findHistory(
    @Query() query: PaginationQueryDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderService.findHistory(query, {
      userId: user.sub,
      roles: user.roles,
    });
  }

  // Definido antes de ':id' para que 'export' no sea interpretado como un id.
  @Auth(Role.ADMIN, Role.SUPERUSER, Role.RECEPCION)
  @Get('export')
  async exportOrders(
    @Query() query: OrderExportQueryDto,
    @ActiveUser() user: AccessTokenPayload,
    @Res() res: Response,
  ) {
    const rows = await this.orderService.exportOrders(
      {
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        statusId: query.statusId,
        area: query.area,
        clientId: query.clientId,
      },
      { userId: user.sub, roles: user.roles },
    );

    const csv = toCsv(
      [
        'ID',
        'Cliente',
        'Área',
        'Estado',
        'Fecha creación',
        'Fecha entrega',
        'Asignado a',
        'Descripción',
      ],
      rows.map((r) => [
        r.id,
        r.cliente,
        r.area,
        r.estado,
        r.fechaCreacion,
        r.fechaEntrega,
        r.asignadoA,
        r.descripcion,
      ]),
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="pedidos.csv"');
    res.send(csv);
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
  @Get(':id')
  findOne(@Param('id') id: string, @ActiveUser() user: AccessTokenPayload) {
    return this.orderService.findOne(+id, {
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
  )
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateOrderDto: UpdateOrderDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderService.update(+id, updateOrderDto, user.sub, {
      userId: user.sub,
      roles: user.roles,
      username: user.username,
    });
  }

  @Auth(Role.SUPERUSER)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.orderService.remove(+id);
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
  @Post(':id/notes')
  createNote(
    @Param('id') id: string,
    @Body() createOrderNoteDto: CreateOrderNoteDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderService.createNote(+id, createOrderNoteDto, {
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
  )
  @Get(':id/notes')
  getNotes(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderService.getNotes(
      +id,
      { userId: user.sub, roles: user.roles },
      query,
    );
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
  @Get(':id/audit-log')
  getAuditLog(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderService.getAuditLog(
      +id,
      { userId: user.sub, roles: user.roles },
      query,
    );
  }

  /** Diseño arma una nueva ronda de montaje y la manda a Recepción. */
  @Auth(Role.DISENO, Role.ADMIN, Role.SUPERUSER)
  @Post(':id/design-revisions')
  createDesignRevision(
    @Param('id') id: string,
    @Body() dto: CreateDesignRevisionDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderService.createDesignRevision(+id, dto, {
      userId: user.sub,
      roles: user.roles,
    });
  }

  /** Cualquiera con acceso al pedido puede ver el historial de rondas. */
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
  @Get(':id/design-revisions')
  getDesignRevisions(
    @Param('id') id: string,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderService.getDesignRevisions(+id, {
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
  )
  @Get(':id/design-revisions/:revisionId/montage')
  getDesignRevisionMontage(
    @Param('id') id: string,
    @Param('revisionId') revisionId: string,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderService.getDesignRevisionMontageFile(+id, +revisionId, {
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
  )
  @Get(':id/design-revisions/:revisionId/feedback-file')
  getDesignRevisionFeedbackFile(
    @Param('id') id: string,
    @Param('revisionId') revisionId: string,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderService.getDesignRevisionFeedbackFile(
      +id,
      +revisionId,
      { userId: user.sub, roles: user.roles },
    );
  }

  /** Recepción carga el feedback del cliente sobre una ronda de montaje. */
  @Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
  @Patch(':id/design-revisions/:revisionId/feedback')
  addDesignFeedback(
    @Param('id') id: string,
    @Param('revisionId') revisionId: string,
    @Body() dto: AddDesignFeedbackDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderService.addDesignFeedback(+id, +revisionId, dto, {
      userId: user.sub,
      roles: user.roles,
    });
  }

  /** Recepción marca que el cliente autorizó el montaje. */
  @Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
  @Patch(':id/design-revisions/:revisionId/approve')
  approveDesignRevision(
    @Param('id') id: string,
    @Param('revisionId') revisionId: string,
    @Body() dto: ApproveDesignRevisionDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderService.approveDesignRevision(+id, +revisionId, dto, {
      userId: user.sub,
      roles: user.roles,
    });
  }
}
