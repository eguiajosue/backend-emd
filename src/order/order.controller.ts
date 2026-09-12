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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
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
import { BulkOrderActionDto } from './dto/bulk-order-action.dto';
import {
  SetOrderAreasDto,
  UpdateAreaTaskStatusDto,
  AssignAreaTaskDto,
} from './dto/order-area-task.dto';
import { OrderAreaTaskService } from './order-area-task.service';
import {
  CreateOrderMaterialItemDto,
  UpdateOrderMaterialItemDto,
} from './dto/order-material-item.dto';
import { OrderMaterialItemService } from './order-material-item.service';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';
import { toCsv } from 'src/common/utils/csv';

@ApiTags('orders')
@Controller('orders')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly orderAreaTaskService: OrderAreaTaskService,
    private readonly orderMaterialItemService: OrderMaterialItemService,
  ) {}

  // Límite más estricto que el default global: creación de pedidos es una
  // escritura "cara" (valida cliente/productos, puede incluir el archivo de
  // recursos que mandó el cliente) y no debería dispararse en ráfaga.
  @Throttle({ default: { limit: 20, ttl: 60000 } })
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

  // Acción masiva: mismos roles que PATCH /orders/:id (mismo criterio de
  // acceso por pedido, validado individualmente dentro del service).
  // Throttle propio, más estricto que el default global: cada request ya
  // puede tocar hasta 100 pedidos, así que se limita la frecuencia con la
  // que se puede disparar.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
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
  @Post('bulk-actions')
  bulkActions(
    @Body() bulkOrderActionDto: BulkOrderActionDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderService.bulkUpdateStatusOrArea(bulkOrderActionDto, {
      userId: user.sub,
      roles: user.roles,
      username: user.username,
    });
  }

  // Definido antes de ':id' para que 'history' no sea interpretado como un id.
  // NOTA: este endpoint es el tablero histórico de pedidos (misma visibilidad
  // por área/rol que `findAll`), no el log de auditoría de cambios — por eso
  // mantiene acceso también para los roles operativos.
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

  /**
   * Bandeja de producción del usuario: sólo las tareas de SUS áreas, cada una
   * etiquetada con la suya (WORKFLOW.md §4). Definido antes de ':id' para que
   * "my-area-tasks" no se interprete como un id de pedido.
   */
  @Auth(
    Role.RECEPCION,
    Role.ADMIN,
    Role.SUPERUSER,
    Role.TALLER,
    Role.DTF,
    Role.BORDADO,
    Role.LASER,
    Role.IMPRESIONES,
  )
  @Get('my-area-tasks')
  getMyAreaTasks(@ActiveUser() user: AccessTokenPayload) {
    return this.orderAreaTaskService.findForUser({
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

  @Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.orderService.remove(+id);
  }

  /**
   * Recepción "atiende" el pedido: otra recepcionista lo toma para que el
   * circuito no se trabe si la que lo creó está de franco. El creador
   * (`userId`) no cambia; los avisos pasan a ir a quien lo tomó.
   * Idempotente: volver a tomarlo no es un error (WORKFLOW.md §2).
   *
   * Sin ADMIN a propósito: admin genera pedidos pero no los trabaja. El
   * único rol que puede hacer de todo es SUPERUSER.
   */
  @HttpCode(HttpStatus.OK)
  @Auth(Role.RECEPCION, Role.SUPERUSER)
  @Post(':id/take-reception')
  takeReception(
    @Param('id') id: string,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderService.takeReception(+id, {
      userId: user.sub,
      roles: user.roles,
      username: user.username,
    });
  }

  /**
   * Un diseñador toma un pedido que quedó en la cuenta compartida del área
   * ("Cualquier diseñador"). Botón explícito, no automático al subir el
   * montaje. No se le roba el pedido a un compañero: si ya lo tiene otra
   * persona real, 400 (WORKFLOW.md §1.a).
   *
   * Sin ADMIN a propósito: admin genera pedidos pero no los trabaja. El
   * único rol que puede hacer de todo es SUPERUSER.
   */
  @HttpCode(HttpStatus.OK)
  @Auth(Role.DISENO, Role.SUPERUSER)
  @Post(':id/take-design')
  takeDesign(@Param('id') id: string, @ActiveUser() user: AccessTokenPayload) {
    return this.orderService.takeDesign(+id, {
      userId: user.sub,
      roles: user.roles,
      username: user.username,
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

  // Auditoría del pedido: sólo recepción/admin/superuser (no roles operativos).
  @Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
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
  // Sube un archivo (base64, hasta 5MB): throttle más estricto que el
  // default global.
  @Throttle({ default: { limit: 20, ttl: 60000 } })
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
    return this.orderService.getDesignRevisionFeedbackFile(+id, +revisionId, {
      userId: user.sub,
      roles: user.roles,
    });
  }

  /**
   * Descarga de UN archivo puntual de la ronda. Una ronda puede llevar varias
   * imágenes o un PDF (WORKFLOW.md §2); los endpoints `/montage` y
   * `/feedback-file` siguen devolviendo el primero de cada tipo.
   */
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
  @Get(':id/design-revisions/:revisionId/files/:fileId')
  getDesignRevisionFile(
    @Param('id') id: string,
    @Param('revisionId') revisionId: string,
    @Param('fileId') fileId: string,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderService.getDesignRevisionFile(+id, +revisionId, +fileId, {
      userId: user.sub,
      roles: user.roles,
    });
  }

  /** Recepción carga el feedback del cliente sobre una ronda de montaje. */
  // Sube un archivo (base64, hasta 5MB): throttle más estricto que el
  // default global.
  @Throttle({ default: { limit: 20, ttl: 60000 } })
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

  /**
   * Se registra que el cliente autorizó el montaje. Es exclusivo de Recepción
   * (o admin/superuser): es quien habla con el cliente y recibe la respuesta.
   * Diseño ya no puede autorizar (WORKFLOW.md §2).
   */
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

  // --- Tareas de área (producción multi-área en paralelo, WORKFLOW.md §3) ---

  /** Áreas que trabajan el pedido, cada una con su estado y responsable. */
  @Auth(
    Role.RECEPCION,
    Role.ADMIN,
    Role.SUPERUSER,
    Role.DISENO,
    Role.TALLER,
    Role.DTF,
    Role.BORDADO,
    Role.LASER,
    Role.IMPRESIONES,
  )
  @Get(':id/area-tasks')
  getAreaTasks(@Param('id') id: string) {
    return this.orderAreaTaskService.findByOrder(+id);
  }

  /** Suma áreas al pedido. Recepción al crear, Diseño al autorizar. */
  @Auth(Role.RECEPCION, Role.DISENO, Role.ADMIN, Role.SUPERUSER)
  @Post(':id/area-tasks')
  addAreaTasks(@Param('id') id: string, @Body() dto: SetOrderAreasDto) {
    return this.orderAreaTaskService.createTasksForAreas(+id, dto.areas);
  }

  /** Avance de una tarea. Sólo el área dueña (o Recepción/admin). */
  @Auth(
    Role.RECEPCION,
    Role.ADMIN,
    Role.SUPERUSER,
    Role.TALLER,
    Role.DTF,
    Role.BORDADO,
    Role.LASER,
    Role.IMPRESIONES,
  )
  @Patch(':id/area-tasks/:taskId/status')
  updateAreaTaskStatus(
    @Param('taskId') taskId: string,
    @Body() dto: UpdateAreaTaskStatusDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderAreaTaskService.updateStatus(+taskId, dto.status, {
      userId: user.sub,
      roles: user.roles,
    });
  }

  /** Reasigna una tarea (o alguien del área se la toma). */
  @Auth(
    Role.RECEPCION,
    Role.ADMIN,
    Role.SUPERUSER,
    Role.TALLER,
    Role.DTF,
    Role.BORDADO,
    Role.LASER,
    Role.IMPRESIONES,
  )
  @Patch(':id/area-tasks/:taskId/assign')
  assignAreaTask(
    @Param('taskId') taskId: string,
    @Body() dto: AssignAreaTaskDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderAreaTaskService.assign(
      +taskId,
      dto.assignedUserId ?? null,
      {
        userId: user.sub,
        roles: user.roles,
      },
    );
  }

  /** Quita un área del pedido. */
  @Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
  @Delete(':id/area-tasks/:taskId')
  removeAreaTask(
    @Param('taskId') taskId: string,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderAreaTaskService.remove(+taskId, {
      userId: user.sub,
      roles: user.roles,
    });
  }

  /**
   * Hoja de materiales del pedido: opcional, no bloquea autorizar el
   * montaje. La carga Recepción (o admin/superuser) cuando el pedido pasa
   * a producción, para que el área sepa qué se va a usar.
   */
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
  @Get(':id/materials')
  getMaterialItems(@Param('id') id: string) {
    return this.orderMaterialItemService.findByOrder(+id);
  }

  @Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
  @Post(':id/materials')
  addMaterialItem(
    @Param('id') id: string,
    @Body() dto: CreateOrderMaterialItemDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.orderMaterialItemService.create(+id, dto, user.sub);
  }

  @Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
  @Patch(':id/materials/:itemId')
  updateMaterialItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateOrderMaterialItemDto,
  ) {
    return this.orderMaterialItemService.update(+id, +itemId, dto);
  }

  @Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
  @Delete(':id/materials/:itemId')
  removeMaterialItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.orderMaterialItemService.remove(+id, +itemId);
  }
}
