import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto, AuthorizationFileDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { Prisma } from '@prisma/client';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import {
  buildPaginatedResult,
  PaginationQueryDto,
  resolvePagination,
} from 'src/common/dto/pagination-query.dto';
import { AreaVisibilityService } from 'src/area-visibility/area-visibility.service';
import { isFullVisibilityRole, operationalRolesOf } from './role-stage-mapping';
import { OrderProductPresetService } from 'src/order-product-preset/order-product-preset.service';
import { OrderProductDto } from './dto/create-order.dto';
import { CreateOrderNoteDto } from './dto/create-order-note.dto';
import { NotificationService } from 'src/notification/notification.service';

/** Roles + id del usuario autenticado, usados para filtrar pedidos por área. */
export interface RequestingUser {
  userId: number;
  roles: string[];
}

/** Tamaño máximo (en bytes, ya decodificado) para la hoja de autorización. */
const MAX_AUTHORIZATION_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Id del estado "entregado", sembrado por prisma/seed.ts (ver STATUS_NAMES,
 * 5to y último status creado en una DB nueva). Coincide con
 * DELIVERED_STATUS_ID en frontend-emd/src/lib/orderStatus.ts.
 */
const DELIVERED_STATUS_ID = 5;

/** Selección liviana del historial, solo lo necesario para calcular `deliveredAt`. */
const HISTORY_SELECT_FOR_DELIVERED_AT = {
  select: {
    changeDate: true,
    newStatusId: true,
  },
  orderBy: { changeDate: 'desc' as const },
} satisfies { select: Prisma.OrderHistorySelect; orderBy: unknown };

/**
 * Selección liviana del usuario asignado: solo lo necesario para mostrarlo
 * en listados/detalle, sin exponer roles ni otros datos sensibles del User.
 */
const ASSIGNED_USER_SELECT = {
  select: {
    id: true,
    firstName: true,
    lastName: true,
    username: true,
    isSharedAccount: true,
  },
} satisfies { select: Prisma.UserSelect };

@Injectable()
export class OrderService {
  constructor(
    private prisma: PrismaService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly areaVisibilityService: AreaVisibilityService,
    private readonly orderProductPresetService: OrderProductPresetService,
    private readonly notificationService: NotificationService,
  ) {}

  /** Valida que cada línea de producto tenga productId y/o customName. */
  private assertOrderProductsValid(orderProducts?: OrderProductDto[]) {
    if (!orderProducts) {
      return;
    }
    for (const op of orderProducts) {
      if (!op.productId && !op.customName?.trim()) {
        throw new HttpException(
          'Cada producto debe tener un producto registrado o un nombre',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }

  /**
   * Da de alta automáticamente (si no existe) cada `customName` usado como
   * "producto frecuente", para que el selector del frontend crezca solo.
   */
  private async registerCustomNamePresets(orderProducts?: OrderProductDto[]) {
    if (!orderProducts) {
      return;
    }
    for (const op of orderProducts) {
      if (op.customName?.trim()) {
        await this.orderProductPresetService.ensureExists(op.customName);
      }
    }
  }

  /**
   * Filtra los pedidos según el área/rol del usuario autenticado.
   *
   * - admin/superuser/recepcion: ven todo, sin cambios.
   * - Roles puramente operativos: se filtra DIRECTO por `order.area` (el
   *   área del pedido coincide textualmente con el nombre del rol, ya no
   *   se mapea contra el status). Para cada rol operativo del usuario:
   *   si su AreaVisibilitySetting.generalViewEnabled es true, todos los
   *   pedidos de esa área quedan visibles; si es false, solo quedan
   *   visibles los pedidos de esa área sin asignar (assignedUserId null) o
   *   asignados al propio usuario. Pedidos con `area: null` (datos viejos
   *   sin migrar) no son visibles para roles operativos.
   */
  private async filterOrdersForUser<
    T extends { area: string | null; assignedUserId: number | null },
  >(orders: T[], requestingUser?: RequestingUser): Promise<T[]> {
    if (!requestingUser) {
      return orders;
    }
    const { userId, roles } = requestingUser;

    if (isFullVisibilityRole(roles)) {
      return orders;
    }

    const userOperationalRoles = operationalRolesOf(roles);
    if (userOperationalRoles.length === 0) {
      // Usuario sin ningún rol operativo ni de visibilidad total: no ve nada.
      return [];
    }

    const settings = await this.areaVisibilityService.findAll();
    const generalViewByRole = new Map(
      settings.map((s) => [s.role, s.generalViewEnabled]),
    );

    // Áreas donde el usuario tiene vista general habilitada.
    const generalViewAreas = new Set<string>();
    // Todas las áreas alcanzables por los roles del usuario (con o sin vista general).
    const allUserAreas = new Set<string>(userOperationalRoles);
    for (const role of userOperationalRoles) {
      if (generalViewByRole.get(role) !== false) {
        generalViewAreas.add(role);
      }
    }

    return orders.filter((order) => {
      const area = order.area;
      if (!area || !allUserAreas.has(area)) {
        return false;
      }
      if (generalViewAreas.has(area)) {
        return true;
      }
      // Área con vista general deshabilitada para todos los roles del
      // usuario que la alcanzan: solo visible si no está asignada o está
      // asignada a este usuario.
      return order.assignedUserId == null || order.assignedUserId === userId;
    });
  }

  /**
   * Verifica que `requestingUser` tenga acceso al pedido `orderId` (mismo
   * criterio de visibilidad por área/rol que `findAll`/`findHistory`), y
   * devuelve el pedido base (`area`, `assignedUserId`) si es así. Usado por
   * los endpoints de notas y auditoría de un pedido individual.
   */
  private async assertOrderAccess(
    orderId: number,
    requestingUser?: RequestingUser,
  ): Promise<{
    id: number;
    area: string | null;
    assignedUserId: number | null;
  }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, area: true, assignedUserId: true },
    });
    if (!order) {
      throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);
    }
    const visible = await this.filterOrdersForUser([order], requestingUser);
    if (visible.length === 0) {
      throw new HttpException(
        'No tenés acceso a este pedido',
        HttpStatus.FORBIDDEN,
      );
    }
    return order;
  }

  /** Valida el tamaño decodificado del archivo de autorización. */
  private assertAuthorizationFileSize(file: AuthorizationFileDto) {
    const sizeInBytes = Buffer.byteLength(file.data, 'base64');
    if (sizeInBytes > MAX_AUTHORIZATION_FILE_BYTES) {
      throw new HttpException(
        'El archivo no puede superar 5MB',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async create(createOrderDto: CreateOrderDto) {
    try {
      const {
        clientId,
        clientNameOverride,
        userId,
        assignedUserId,
        statusId,
        area,
        description,
        deliveryDate,
        orderProducts,
        authorizationFile,
      } = createOrderDto;

      if (!userId || !statusId) {
        throw new HttpException(
          'Datos faltantes: userId o statusId',
          HttpStatus.BAD_REQUEST,
        );
      }

      const trimmedClientNameOverride = clientNameOverride?.trim();
      if (!clientId && !trimmedClientNameOverride) {
        throw new HttpException(
          'Debe indicar un cliente registrado o escribir el nombre del cliente',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (authorizationFile) {
        this.assertAuthorizationFileSize(authorizationFile);
      }

      this.assertOrderProductsValid(orderProducts);
      await this.registerCustomNamePresets(orderProducts);

      const data: Prisma.OrderCreateInput = {
        description,
        area,
        creationDate: new Date(),
        deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
        ...(clientId
          ? {
              client: {
                connect: { id: clientId },
              },
            }
          : undefined),
        clientNameOverride: trimmedClientNameOverride || undefined,
        user: {
          connect: { id: userId },
        },
        ...(assignedUserId && {
          assignedUser: {
            connect: { id: assignedUserId },
          },
        }),
        status: {
          connect: { id: statusId },
        },
        orderProducts: orderProducts
          ? {
              create: orderProducts.map((op) => ({
                quantity: op.quantity,
                customName: op.customName?.trim() || undefined,
                ...(op.productId && {
                  product: { connect: { id: op.productId } },
                }),
              })),
            }
          : undefined,
        ...(authorizationFile && {
          authorizationFileData: authorizationFile.data,
          authorizationFileName: authorizationFile.filename,
          authorizationFileMime: authorizationFile.mimeType,
        }),
      };

      const order = await this.prisma.order.create({
        data,
        include: {
          client: true,
          user: true,
          assignedUser: ASSIGNED_USER_SELECT,
          status: true,
          orderProducts: {
            include: {
              product: true,
            },
          },
        },
      });

      // Validar que los datos de la orden son correctos antes de enviarlos al gateway
      const clientNameForNotification =
        order?.client?.first_name || order?.clientNameOverride;

      if (
        order &&
        clientNameForNotification &&
        order.user &&
        order.user.username
      ) {
        const adminNotificationData = {
          id: order.id,
          description: order.description,
          clientName: clientNameForNotification,
          createdBy: order.user.username,
          creationDate: order.creationDate,
          deliveryDate: order.deliveryDate,
        };

        this.notificationsGateway.notifyNewOrderToAdmin(adminNotificationData);

        if (order.assignedUserId) {
          // Pedido asignado directamente a un usuario: notificación dirigida
          // solo a él, además de la del admin.
          this.notificationsGateway.notifyNewAssignedOrder(
            order.assignedUserId,
            {
              orderId: order.id,
              description: order.description,
              area: order.area,
              deliveryDate: order.deliveryDate,
              clientName: clientNameForNotification,
            },
          );
          // Persistencia: misma notificación, para que no se pierda si el
          // usuario asignado no tenía sesión abierta en ese momento.
          await this.notificationService.createNotification({
            userId: order.assignedUserId,
            type: 'order_assigned',
            title: 'Pedido asignado',
            body: `Se te asignó el pedido #${order.id}${clientNameForNotification ? ` de ${clientNameForNotification}` : ''}`,
            orderId: order.id,
          });
        } else if (order.area) {
          // Pedido sin asignar: queda disponible para cualquiera del área,
          // se notifica a la room del rol/área correspondiente.
          this.notificationsGateway.notifyNewOrderToArea(order.area, {
            orderId: order.id,
            description: order.description,
            area: order.area,
            deliveryDate: order.deliveryDate,
            clientName: clientNameForNotification,
          });
          // Persistencia: mismo criterio que el WS, un registro por cada
          // usuario que tiene el rol/área del pedido.
          const areaUserIds = await this.notificationService.userIdsForArea(
            order.area,
          );
          await this.notificationService.createNotificationForUsers(
            areaUserIds,
            {
              type: 'order_assigned',
              title: 'Nuevo pedido para tu área',
              body: `Nuevo pedido #${order.id}${clientNameForNotification ? ` de ${clientNameForNotification}` : ''} sin asignar en ${order.area}`,
              orderId: order.id,
            },
          );
        }
      } else {
        throw new HttpException(
          'Datos incompletos para la notificación',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      return order;
    } catch (error) {
      if (error.code === 'P2003') {
        // Fallo en restricción de clave foránea
        throw new HttpException(
          'ID de cliente, usuario, estado o producto inválido',
          HttpStatus.BAD_REQUEST,
        );
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  /**
   * Paginación OPT-IN: sin `page`/`limit` devuelve el array plano de siempre.
   */
  /**
   * Listado: NO trae `authorizationFileData` de la DB (es potencialmente
   * pesado en base64 y rompería el rendimiento del listado). En su lugar
   * expone un booleano `hasAuthorizationFile` calculado.
   */
  /** Select común para listados: incluye `histories` liviano para calcular `deliveredAt`. */
  private orderListSelect() {
    return {
      id: true,
      clientId: true,
      clientNameOverride: true,
      userId: true,
      assignedUserId: true,
      statusId: true,
      area: true,
      description: true,
      creationDate: true,
      deliveryDate: true,
      authorizationFileName: true,
      client: true,
      user: true,
      assignedUser: ASSIGNED_USER_SELECT,
      status: true,
      orderProducts: {
        include: {
          product: true,
        },
      },
      histories: HISTORY_SELECT_FOR_DELIVERED_AT,
    } satisfies Prisma.OrderSelect;
  }

  /**
   * Fecha (ISO string) del cambio de estado más reciente hacia "entregado",
   * o null si el pedido nunca llegó a ese estado. `histories` debe venir
   * ordenado por `changeDate desc` (ver HISTORY_SELECT_FOR_DELIVERED_AT).
   */
  private computeDeliveredAt(
    histories: { changeDate: Date; newStatusId: number }[] | undefined,
  ): string | null {
    const delivered = histories?.find(
      (h) => h.newStatusId === DELIVERED_STATUS_ID,
    );
    return delivered ? delivered.changeDate.toISOString() : null;
  }

  private toListItem = (order: {
    authorizationFileName: string | null;
    histories?: { changeDate: Date; newStatusId: number }[];
    [key: string]: unknown;
  }) => {
    const { authorizationFileName, histories, ...rest } = order;
    return {
      ...rest,
      hasAuthorizationFile: authorizationFileName != null,
      deliveredAt: this.computeDeliveredAt(histories),
    };
  };

  async findAll(query?: PaginationQueryDto, requestingUser?: RequestingUser) {
    try {
      const select = this.orderListSelect();
      const { enabled, page, limit, skip } = resolvePagination(query);

      if (!enabled) {
        const orders = await this.prisma.order.findMany({ select });
        const visible = await this.filterOrdersForUser(orders, requestingUser);
        return visible.map(this.toListItem);
      }

      // Con restricción de visibilidad por área, el filtrado depende de
      // configuración dinámica (AreaVisibilitySetting) y no puede resolverse
      // enteramente en el WHERE de Prisma sin duplicar esa lógica; con el
      // volumen actual de datos se trae todo ordenado, se filtra en memoria
      // y se pagina sobre el resultado ya filtrado.
      const allMatching = await this.prisma.order.findMany({
        select,
        orderBy: { id: 'desc' },
      });
      const visible = await this.filterOrdersForUser(
        allMatching,
        requestingUser,
      );
      const total = visible.length;
      const data = visible.slice(skip, skip + limit);

      return buildPaginatedResult(
        data.map(this.toListItem),
        total,
        page,
        limit,
      );
    } catch (error) {
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  /**
   * Historial completo de pedidos para el tablero: misma visibilidad por
   * área/rol que `findAll`, pero SIN filtrar por antigüedad de entrega (los
   * pedidos nunca se borran/ocultan en DB; el "recently delivered" es solo
   * una ventana de visibilidad del tablero en vivo, resuelta en el cliente
   * con `deliveredAt` + `GET /settings`). Siempre ordenado por
   * `creationDate desc` y paginado igual que `findAll`.
   */
  async findHistory(
    query?: PaginationQueryDto,
    requestingUser?: RequestingUser,
  ) {
    try {
      const select = this.orderListSelect();
      // Paginación siempre activa para /orders/history (a diferencia de
      // `findAll`, que es opt-in): evita traer todo el histórico sin límite.
      const { page, limit, skip } = resolvePagination(query ?? {});

      const allMatching = await this.prisma.order.findMany({
        select,
        orderBy: { creationDate: 'desc' },
      });
      const visible = await this.filterOrdersForUser(
        allMatching,
        requestingUser,
      );
      const total = visible.length;
      const data = visible.slice(skip, skip + limit);

      return buildPaginatedResult(
        data.map(this.toListItem),
        total,
        page,
        limit,
      );
    } catch (error) {
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async findOne(id: number, requestingUser?: RequestingUser) {
    try {
      // Corrige un hueco de seguridad: antes cualquier usuario autenticado
      // con rol operativo podía leer el detalle de cualquier orden por id,
      // sin importar su área. Mismo criterio de visibilidad que findAll.
      await this.assertOrderAccess(id, requestingUser);
      const order = await this.prisma.order.findUnique({
        where: { id },
        include: {
          client: true,
          user: true,
          assignedUser: ASSIGNED_USER_SELECT,
          status: true,
          orderProducts: {
            include: {
              product: true,
            },
          },
          histories: HISTORY_SELECT_FOR_DELIVERED_AT,
        },
      });
      if (!order) {
        throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);
      }

      const {
        authorizationFileData,
        authorizationFileName,
        authorizationFileMime,
        histories,
        ...rest
      } = order;

      return {
        ...rest,
        authorizationFile: authorizationFileData
          ? {
              filename: authorizationFileName,
              mimeType: authorizationFileMime,
              dataUrl: `data:${authorizationFileMime};base64,${authorizationFileData}`,
            }
          : null,
        deliveredAt: this.computeDeliveredAt(histories),
      };
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw error;
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async update(
    id: number,
    updateOrderDto: UpdateOrderDto,
    requestingUserId?: number,
  ) {
    try {
      const {
        clientId,
        clientNameOverride,
        userId,
        statusId,
        area,
        description,
        deliveryDate,
        orderProducts,
        authorizationFile,
      } = updateOrderDto;
      const hasAssignedUserId = 'assignedUserId' in updateOrderDto;
      const { assignedUserId } = updateOrderDto;

      if (authorizationFile) {
        this.assertAuthorizationFileSize(authorizationFile);
      }

      this.assertOrderProductsValid(orderProducts);
      await this.registerCustomNamePresets(orderProducts);

      // Obtener la orden actual antes de actualizar
      const existingOrder = await this.prisma.order.findUnique({
        where: { id },
        include: {
          status: true,
        },
      });

      if (!existingOrder) {
        throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);
      }

      // Auditoría: diff de los campos "editables" relevantes (no incluye
      // cambio de estado, que ya queda registrado en OrderHistory).
      const auditChanges: Record<string, { before: unknown; after: unknown }> =
        {};
      const noteChange = (field: string, before: unknown, after: unknown) => {
        if (after === undefined) return;
        if (before === (after ?? null)) return;
        auditChanges[field] = { before: before ?? null, after: after ?? null };
      };
      if (description !== undefined) {
        noteChange('description', existingOrder.description, description);
      }
      if (deliveryDate !== undefined) {
        const newDeliveryDate = deliveryDate ? new Date(deliveryDate) : null;
        noteChange(
          'deliveryDate',
          existingOrder.deliveryDate?.toISOString() ?? null,
          newDeliveryDate?.toISOString() ?? null,
        );
      }
      if (hasAssignedUserId) {
        noteChange(
          'assignedUserId',
          existingOrder.assignedUserId,
          assignedUserId ?? null,
        );
      }
      if (area !== undefined) {
        noteChange('area', existingOrder.area, area);
      }
      if (clientId !== undefined) {
        noteChange('clientId', existingOrder.clientId, clientId);
      }
      if (clientNameOverride !== undefined) {
        noteChange(
          'clientNameOverride',
          existingOrder.clientNameOverride,
          clientNameOverride,
        );
      }

      const data: Prisma.OrderUpdateInput = {
        ...(description && { description }),
        ...(area && { area }),
        ...(deliveryDate && { deliveryDate: new Date(deliveryDate) }),
        ...(clientId && {
          client: {
            connect: { id: clientId },
          },
        }),
        ...(clientNameOverride !== undefined && { clientNameOverride }),
        ...(userId && {
          user: {
            connect: { id: userId },
          },
        }),
        // assignedUserId tiene una relación declarada (assignedUser), así que
        // Prisma exige la sintaxis de relación (connect/disconnect) en el
        // UpdateInput "checked" en vez del escalar crudo — asignarlo directo
        // como campo plano compila (TS no chequea el excess-property en un
        // spread) pero explota en runtime con PrismaClientValidationError.
        ...(hasAssignedUserId && {
          assignedUser:
            assignedUserId != null
              ? { connect: { id: assignedUserId } }
              : { disconnect: true },
        }),
        ...(statusId && {
          status: {
            connect: { id: statusId },
          },
        }),
        ...(orderProducts && {
          orderProducts: {
            deleteMany: {}, // Elimina los productos existentes en la orden
            create: orderProducts.map((op) => ({
              quantity: op.quantity,
              customName: op.customName?.trim() || undefined,
              ...(op.productId && {
                product: { connect: { id: op.productId } },
              }),
            })),
          },
        }),
        ...(authorizationFile && {
          authorizationFileData: authorizationFile.data,
          authorizationFileName: authorizationFile.filename,
          authorizationFileMime: authorizationFile.mimeType,
        }),
      };

      const updatedOrder = await this.prisma.order.update({
        where: { id },
        data,
        include: {
          client: true,
          user: true,
          assignedUser: ASSIGNED_USER_SELECT,
          status: true,
          orderProducts: {
            include: {
              product: true,
            },
          },
        },
      });

      // Verificar si el estatus de la orden ha cambiado y notificar al administrador
      if (existingOrder.status.id !== updatedOrder.status.id) {
        const orderStatusChangeData = {
          id: updatedOrder.id,
          status: updatedOrder.status.name,
          previousStatus: existingOrder.status.name,
        };
        this.notificationsGateway.notifyOrderStatusChange(
          orderStatusChangeData,
        );

        // Persistencia: al usuario asignado (si lo hay) le queda guardado el
        // cambio de estado, mismo criterio de destinatario que el resto de
        // las notificaciones dirigidas de este pedido.
        if (updatedOrder.assignedUserId) {
          await this.notificationService.createNotification({
            userId: updatedOrder.assignedUserId,
            type: 'order_status_changed',
            title: 'Cambio de estado de pedido',
            body: `El pedido #${updatedOrder.id} pasó de "${existingOrder.status.name}" a "${updatedOrder.status.name}"`,
            orderId: updatedOrder.id,
          });
        }
      }

      if (Object.keys(auditChanges).length > 0 && requestingUserId) {
        await this.prisma.orderAuditLog.create({
          data: {
            action: 'updated',
            changes: auditChanges as Prisma.InputJsonValue,
            order: { connect: { id } },
            user: { connect: { id: requestingUserId } },
          },
        });
      }

      return updatedOrder;
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);
      }
      if (error.code === 'P2003') {
        // Fallo en restricción de clave foránea
        throw new HttpException(
          'ID de cliente, usuario, estado o producto inválido',
          HttpStatus.BAD_REQUEST,
        );
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  /** Crea una nota interna en un pedido y notifica al área/usuario asignado. */
  async createNote(
    orderId: number,
    createOrderNoteDto: CreateOrderNoteDto,
    requestingUser: RequestingUser,
  ) {
    const order = await this.assertOrderAccess(orderId, requestingUser);

    const note = await this.prisma.orderNote.create({
      data: {
        text: createOrderNoteDto.text,
        order: { connect: { id: orderId } },
        user: { connect: { id: requestingUser.userId } },
      },
      include: { user: ASSIGNED_USER_SELECT },
    });

    this.notificationsGateway.notifyOrderNoteAdded(
      { assignedUserId: order.assignedUserId, area: order.area },
      {
        orderId,
        noteId: note.id,
        text: note.text,
        authorUsername: note.user.username,
        createdAt: note.createdAt,
      },
    );

    return note;
  }

  /** Lista las notas de un pedido, ordenadas por fecha de creación ascendente. */
  async getNotes(
    orderId: number,
    requestingUser: RequestingUser,
    query?: PaginationQueryDto,
  ) {
    await this.assertOrderAccess(orderId, requestingUser);

    const { enabled, page, limit, skip } = resolvePagination(query);
    const where = { orderId };
    const include = { user: ASSIGNED_USER_SELECT };

    if (!enabled) {
      return this.prisma.orderNote.findMany({
        where,
        include,
        orderBy: { createdAt: 'asc' },
      });
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.orderNote.findMany({
        where,
        include,
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.orderNote.count({ where }),
    ]);

    return buildPaginatedResult(data, total, page, limit);
  }

  /** Lista el log de auditoría de ediciones de un pedido, más reciente primero. */
  async getAuditLog(
    orderId: number,
    requestingUser: RequestingUser,
    query?: PaginationQueryDto,
  ) {
    await this.assertOrderAccess(orderId, requestingUser);

    const { enabled, page, limit, skip } = resolvePagination(query);
    const where = { orderId };
    const include = { user: ASSIGNED_USER_SELECT };

    if (!enabled) {
      return this.prisma.orderAuditLog.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
      });
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.orderAuditLog.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.orderAuditLog.count({ where }),
    ]);

    return buildPaginatedResult(data, total, page, limit);
  }

  /**
   * Pedidos de un cliente específico, con el mismo filtrado de
   * visibilidad por área/rol que `findAll`. Sin paginación forzada:
   * respeta el mismo contrato opt-in.
   */
  async findAllByClient(
    clientId: number,
    query?: PaginationQueryDto,
    requestingUser?: RequestingUser,
  ) {
    const select = this.orderListSelect();
    const { enabled, page, limit, skip } = resolvePagination(query);
    const where = { clientId };

    if (!enabled) {
      const orders = await this.prisma.order.findMany({
        where,
        select,
        orderBy: { id: 'desc' },
      });
      const visible = await this.filterOrdersForUser(orders, requestingUser);
      return visible.map(this.toListItem);
    }

    const allMatching = await this.prisma.order.findMany({
      where,
      select,
      orderBy: { id: 'desc' },
    });
    const visible = await this.filterOrdersForUser(allMatching, requestingUser);
    const total = visible.length;
    const data = visible.slice(skip, skip + limit);
    return buildPaginatedResult(data.map(this.toListItem), total, page, limit);
  }

  /**
   * Filas planas para exportación CSV, respetando la misma visibilidad por
   * área/rol y los mismos filtros de fecha/estado/área/cliente que
   * `findAll` acepta vía query params (aplicados en el controller/frontend
   * hoy no existen filtros dedicados en `findAll`, así que acá se filtra
   * directo en el WHERE de Prisma sobre los campos soportados).
   */
  async exportOrders(
    filters: {
      dateFrom?: string;
      dateTo?: string;
      statusId?: number;
      area?: string;
      clientId?: number;
    },
    requestingUser?: RequestingUser,
  ) {
    const where: Prisma.OrderWhereInput = {
      ...(filters.statusId && { statusId: filters.statusId }),
      ...(filters.area && { area: filters.area }),
      ...(filters.clientId && { clientId: filters.clientId }),
      ...((filters.dateFrom || filters.dateTo) && {
        creationDate: {
          ...(filters.dateFrom && { gte: new Date(filters.dateFrom) }),
          ...(filters.dateTo && { lte: new Date(filters.dateTo) }),
        },
      }),
    };

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { id: 'desc' },
      include: {
        client: true,
        assignedUser: ASSIGNED_USER_SELECT,
        status: true,
      },
    });

    const visible = await this.filterOrdersForUser(orders, requestingUser);

    return visible.map((order) => ({
      id: order.id,
      cliente: order.client?.first_name ?? order.clientNameOverride ?? '',
      area: order.area ?? '',
      estado: order.status?.name ?? '',
      fechaCreacion: order.creationDate.toISOString(),
      fechaEntrega: order.deliveryDate ? order.deliveryDate.toISOString() : '',
      asignadoA: order.assignedUser
        ? `${order.assignedUser.firstName} ${order.assignedUser.lastName ?? ''}`.trim()
        : '',
      descripcion: order.description ?? '',
    }));
  }

  async remove(id: number) {
    try {
      await this.prisma.order.delete({
        where: { id },
      });
      return { message: 'Orden eliminada correctamente' };
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }
}
