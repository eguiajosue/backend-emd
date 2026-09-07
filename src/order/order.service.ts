import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { assertBase64FileValid } from 'src/common/file-validation';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateOrderDto,
  AuthorizationFileDto,
  AUTHORIZATION_FILE_MIME_TYPES,
} from './dto/create-order.dto';
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
import {
  CreateDesignRevisionDto,
  AddDesignFeedbackDto,
  ApproveDesignRevisionDto,
} from './dto/design-revision.dto';
import { NotificationService } from 'src/notification/notification.service';
import { Role } from 'src/common/enums/roles.enum';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { BulkOrderActionDto } from './dto/bulk-order-action.dto';
import { OrderAreaTaskService } from './order-area-task.service';

/** Roles + id del usuario autenticado, usados para filtrar pedidos por área. */
export interface RequestingUser {
  userId: number;
  roles: string[];
  /** Usado sólo para armar el texto de la notificación genérica a Recepción (Feature 2). */
  username?: string;
}

/** Tamaño máximo (en bytes, ya decodificado) para la hoja de autorización. */
const MAX_AUTHORIZATION_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Id del estado "entregado", sembrado por prisma/seed.ts (ver STATUS_SEEDS,
 * donde se siembra con id explícito = 5). Coincide con
 * DELIVERED_STATUS_ID en frontend-emd/src/lib/orderStatus.ts.
 */
const DELIVERED_STATUS_ID = 5;

/**
 * Nombres de los estados nuevos del flujo de Diseño, sembrados al final de
 * STATUS_SEEDS en prisma/seed.ts (ids 6+ en una DB existente). A diferencia
 * de DELIVERED_STATUS_ID, estos se resuelven por NOMBRE en runtime (ver
 * `resolveStatusIdByName`) y nunca se hardcodea su id, porque en otra DB
 * donde el seed corra en otro orden esos ids podrían diferir.
 */
const STATUS_NAME_EN_DISENO = 'en diseño';
const STATUS_NAME_ESPERANDO_AUTORIZACION = 'esperando autorización';
const STATUS_NAME_CAMBIOS_SOLICITADOS = 'cambios solicitados';
const STATUS_NAME_AUTORIZADO = 'autorizado';

/** Roles que pueden editar `productionArea` en un pedido, además de RECEPCION/ADMIN/SUPERUSER. */
const PRODUCTION_AREA_EDITOR_ROLES = [
  Role.RECEPCION,
  Role.ADMIN,
  Role.SUPERUSER,
  Role.DISENO,
];

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

/**
 * Selección del usuario CREADOR del pedido. Antes se incluía con `user: true`,
 * que arrastra todos los escalares del modelo -- incluido el hash de
 * `password` -- a cada listado y detalle de pedido. El creador sólo se muestra
 * por nombre, así que se acota a los mismos campos que el asignado.
 */
const CREATOR_USER_SELECT = ASSIGNED_USER_SELECT;

@Injectable()
export class OrderService {
  /** Cache en memoria de id de Status por nombre (ver `resolveStatusIdByName`). */
  private statusIdByNameCache = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly areaVisibilityService: AreaVisibilityService,
    private readonly orderProductPresetService: OrderProductPresetService,
    private readonly notificationService: NotificationService,
    private readonly auditLogService: AuditLogService,
    private readonly orderAreaTaskService: OrderAreaTaskService,
  ) {}

  /**
   * Valida que el usuario asignado tenga el rol del área indicada. Aplica tanto
   * a personas concretas como a las cuentas compartidas de área
   * (`isSharedAccount`), que también llevan el rol del área que representan.
   *
   * Evita que un pedido con montaje quede en manos de alguien que no es de
   * Diseño, o que un pedido directo se asigne a alguien de otra área
   * (ver WORKFLOW.md §1).
   */
  private async assertUserBelongsToArea(
    assignedUserId: number | undefined,
    area: string,
  ): Promise<void> {
    if (assignedUserId === undefined) {
      throw new HttpException(
        `Debe asignarse un responsable del área ${area}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id: assignedUserId },
      select: { id: true, roles: { select: { name: true } } },
    });
    if (!user) {
      throw new HttpException(
        'El usuario asignado no existe',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!user.roles.some((r) => r.name === area)) {
      throw new HttpException(
        `El usuario asignado no pertenece al área ${area}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /** Valida que cada línea de producto traiga nombre y cantidad. */
  private assertOrderProductsValid(orderProducts?: OrderProductDto[]) {
    if (!orderProducts) {
      return;
    }
    for (const op of orderProducts) {
      if (!op.customName?.trim()) {
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
   *   se mapea contra el status). Cualquier usuario con un rol operativo
   *   que alcance esa área ve y puede trabajar TODOS los pedidos de esa
   *   área, estén o no asignados a él específicamente: el trabajo dentro
   *   de una misma área es colaborativo (ej. cualquier diseñador puede
   *   tomar cualquier pedido de Diseño). El filtro cruzado entre áreas
   *   distintas se mantiene: un usuario operativo nunca ve pedidos de un
   *   área que no le corresponde. Pedidos con `area: null` (datos viejos
   *   sin migrar) no son visibles para roles operativos.
   *
   * `AreaVisibilitySetting.generalViewEnabled` ya NO restringe esta
   * visibilidad intra-área (decisión de producto: la asignación individual
   * es solo informativa/de seguimiento, no debe bloquear la colaboración
   * dentro de la propia área). El endpoint/tabla se deja intacto por si se
   * reutiliza para otro propósito en el futuro.
   */
  private async filterOrdersForUser<
    T extends { area: string | null; assignedUserId: number | null },
  >(orders: T[], requestingUser?: RequestingUser): Promise<T[]> {
    if (!requestingUser) {
      return orders;
    }
    const { roles } = requestingUser;

    if (isFullVisibilityRole(roles)) {
      return orders;
    }

    const userOperationalRoles = operationalRolesOf(roles);
    if (userOperationalRoles.length === 0) {
      // Usuario sin ningún rol operativo ni de visibilidad total: no ve nada.
      return [];
    }

    // Todas las áreas alcanzables por los roles operativos del usuario.
    const allUserAreas = new Set<string>(userOperationalRoles);

    return orders.filter((order) => {
      const area = order.area;
      return !!area && allUserAreas.has(area);
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
      throw new HttpException('Sin acceso a este pedido', HttpStatus.FORBIDDEN);
    }
    return order;
  }

  /**
   * Valida el tamaño decodificado y el tipo REAL (por contenido, no por el
   * `mimeType` que manda el cliente) del archivo de autorización -- reusado
   * también para el montaje/feedback de diseño.
   *
   * `mimeType` en el DTO ya está restringido por `@IsIn(AUTHORIZATION_FILE_MIME_TYPES)`,
   * pero eso sólo valida el STRING declarado por el cliente: nada impide
   * mandar un .html o un binario ejecutable con `mimeType: 'image/png'` y
   * `filename: 'x.png'`. `file-type` (magic bytes) confirma que el
   * contenido decodificado sea realmente uno de los formatos permitidos, y
   * que coincida con lo declarado.
   */
  private async assertAuthorizationFileSize(file: AuthorizationFileDto) {
    await assertBase64FileValid(file, {
      maxBytes: MAX_AUTHORIZATION_FILE_BYTES,
      allowedMimeTypes: AUTHORIZATION_FILE_MIME_TYPES,
      sizeErrorMessage: 'El archivo no puede superar 5MB',
      typeErrorMessage:
        'El contenido del archivo no coincide con un tipo permitido (PNG, JPEG o PDF)',
    });
  }

  /**
   * Resuelve el id de un `Status` por su nombre exacto, con cache en
   * memoria (los estados no cambian en runtime). Usado para los estados del
   * flujo de Diseño, sembrados al final de STATUS_SEEDS con ids no
   * hardcodeables (ver comentario sobre STATUS_NAME_* arriba).
   */
  private async resolveStatusIdByName(name: string): Promise<number> {
    const cached = this.statusIdByNameCache.get(name);
    if (cached !== undefined) {
      return cached;
    }
    const status = await this.prisma.status.findUnique({ where: { name } });
    if (!status) {
      throw new HttpException(
        `El estado "${name}" no existe. Corré el seed (prisma/seed.ts) para crearlo.`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    this.statusIdByNameCache.set(name, status.id);
    return status.id;
  }

  /**
   * Verifica que el usuario autenticado pueda editar `productionArea`
   * (recepcion/admin/superuser, o diseño). Lanza 403 si no.
   */
  private assertCanEditProductionArea(requestingUser?: RequestingUser) {
    const roles = requestingUser?.roles ?? [];
    const allowed = roles.some((r) =>
      PRODUCTION_AREA_EDITOR_ROLES.includes(r as Role),
    );
    if (!allowed) {
      throw new HttpException(
        'Sin permiso para editar el área de producción',
        HttpStatus.FORBIDDEN,
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
        productionArea,
        productionAreas,
        requiresDesign,
        description,
        deliveryDate,
        orderProducts,
        authorizationFile,
      } = createOrderDto;

      // Default true: si no viene explícito, el pedido pasa por Diseño
      // (comportamiento nuevo). Recepción puede desmarcarlo para ir directo
      // a producción (comportamiento anterior, intacto).
      const needsDesign = requiresDesign !== false;

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
        await this.assertAuthorizationFileSize(authorizationFile);
      }

      this.assertOrderProductsValid(orderProducts);
      await this.registerCustomNamePresets(orderProducts);

      // Con montaje, el responsable inicial tiene que pertenecer a Diseño: o un
      // diseñador concreto, o la cuenta compartida del área ("Cualquier
      // diseñador"). Ver WORKFLOW.md §1.a.
      if (needsDesign) {
        await this.assertUserBelongsToArea(assignedUserId, Role.DISENO);
      } else if (assignedUserId !== undefined && area) {
        // Sin montaje, si se nomina a alguien debe ser del área destino.
        await this.assertUserBelongsToArea(assignedUserId, area);
      }

      // Si requiere Diseño: el pedido arranca EN Diseño (area='diseno',
      // estado 'en diseño') sin importar qué `area`/`statusId` mandó
      // Recepción; `productionArea` queda guardado como destino futuro
      // (puede venir vacío, se define/corrige más adelante). Si no requiere
      // Diseño, comportamiento anterior intacto.
      const resolvedArea = needsDesign ? 'diseno' : area;
      const resolvedStatusId = needsDesign
        ? await this.resolveStatusIdByName(STATUS_NAME_EN_DISENO)
        : statusId;

      const data: Prisma.OrderCreateInput = {
        description,
        area: resolvedArea,
        requiresDesign: needsDesign,
        productionArea: productionArea ?? undefined,
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
          connect: { id: resolvedStatusId },
        },
        orderProducts: orderProducts
          ? {
              create: orderProducts.map((op) => ({
                quantity: op.quantity,
                customName: op.customName.trim(),
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
          user: CREATOR_USER_SELECT,
          assignedUser: ASSIGNED_USER_SELECT,
          status: true,
          orderProducts: true,
        },
      });

      // Tareas de área (WORKFLOW.md §3). Las áreas que trabajan el pedido las
      // define Recepción acá y/o Diseño al autorizar el montaje.
      //  - Sin montaje: el pedido entra directo a producción, así que las
      //    tareas se crean y se notifican ya.
      //  - Con montaje: las áreas elegidas quedan planificadas (tarea creada,
      //    sin notificar) y se avisa a cada área recién al autorizarse el
      //    montaje, que es cuando realmente hay trabajo para ellas.
      const plannedAreas =
        productionAreas && productionAreas.length > 0
          ? productionAreas
          : ([productionArea ?? (needsDesign ? undefined : area)].filter(
              Boolean,
            ) as string[]);
      const productionOnlyAreas = plannedAreas.filter((a) => a !== 'diseno');
      if (productionOnlyAreas.length > 0) {
        await this.orderAreaTaskService.createTasksForAreas(
          order.id,
          productionOnlyAreas,
          { notify: !needsDesign },
        );
      }

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
            title: 'Nuevo pedido asignado',
            body: `Pedido #${order.id}${clientNameForNotification ? ` de ${clientNameForNotification}` : ''} asignado`,
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
              title: 'Nuevo pedido en el área',
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
      requiresDesign: true,
      productionArea: true,
      description: true,
      creationDate: true,
      deliveryDate: true,
      authorizationFileName: true,
      client: true,
      // Trabajo de producción partido por área. Va en el LISTADO (no sólo en el
      // detalle) porque el tablero de producción del frontend agrupa por el
      // estado de la tarea del área del usuario, no por `statusId`: tras la
      // autorización el pedido queda en "autorizado" (dato del circuito de
      // Diseño) mientras cada área arranca su tarea en "pendiente".
      areaTasks: {
        select: {
          id: true,
          area: true,
          status: true,
          assignedUserId: true,
        },
      },
      user: CREATOR_USER_SELECT,
      assignedUser: ASSIGNED_USER_SELECT,
      status: true,
      orderProducts: true,
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
          user: CREATOR_USER_SELECT,
          assignedUser: ASSIGNED_USER_SELECT,
          status: true,
          orderProducts: true,
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

  /**
   * Etiquetas legibles de los campos auditados, para armar el resumen de la
   * notificación genérica a Recepción (Feature 2).
   */
  private static readonly AUDIT_FIELD_LABELS: Record<string, string> = {
    description: 'la descripción',
    deliveryDate: 'la fecha de entrega',
    assignedUserId: 'la asignación',
    statusId: 'el estado',
    area: 'el área',
    productionArea: 'el área de producción',
    requiresDesign: 'si requiere diseño',
    clientId: 'el cliente',
    clientNameOverride: 'el nombre del cliente',
  };

  /**
   * Notifica (persistente + WS) a todos los usuarios con rol `recepcion`
   * que un usuario de un área operativa modificó un pedido. Feature 2:
   * visibilidad general para Recepción de cualquier cambio hecho por un
   * usuario de área, más allá de las notificaciones puntuales ya existentes
   * del flujo de diseño.
   */
  private async notifyAreaUserUpdatedOrder(
    orderId: number,
    requestingUser: RequestingUser,
    auditChanges: Record<string, { before: unknown; after: unknown }>,
  ) {
    const changedLabels = Object.keys(auditChanges).map(
      (field) => OrderService.AUDIT_FIELD_LABELS[field] ?? field,
    );
    const summary = changedLabels.join(', ');
    const updatedByUsername = requestingUser.username ?? 'Un usuario';
    const title = `${updatedByUsername} actualizó el pedido #${orderId}`;
    const body = `${updatedByUsername} modificó ${summary} del pedido #${orderId}`;

    const recepcionUserIds =
      await this.notificationService.userIdsForArea('recepcion');
    await this.notificationService.createNotificationForUsers(
      recepcionUserIds,
      {
        type: 'area_user_updated_order',
        title,
        body,
        orderId,
      },
    );

    this.notificationsGateway.notifyAreaUserUpdatedOrder({
      orderId,
      updatedByUsername,
      summary,
    });
  }

  /**
   * Notifica (persistente + WS) un CAMBIO DE ESTADO del pedido con su propio
   * tipo `order_status_changed`, distinto de la notificación genérica
   * `area_user_updated_order`, para que el frontend pueda renderizar una
   * etiqueta específica ("Cambio de estado").
   *
   * Destinatarios: únicamente los usuarios de Recepción (mismo criterio que
   * `notifyAreaUserUpdatedOrder`). El usuario de área asignado al pedido NO
   * se notifica acá: sólo recibe notificación cuando se le asigna un pedido
   * nuevo (`notifyNewAssignedOrder`), no en cambios posteriores de un pedido
   * que ya tiene asignado.
   */
  private async notifyOrderStatusChanged(
    orderId: number,
    previousStatusName: string,
    newStatusName: string,
    assignedUserId: number | null,
    requestingUser?: RequestingUser,
  ) {
    const changedByUsername = requestingUser?.username ?? 'Un usuario';
    const changedAt = new Date();
    const title = `Cambio de estado del pedido #${orderId}`;
    const body = `${changedByUsername} cambió el estado del pedido #${orderId} de "${previousStatusName}" a "${newStatusName}"`;

    const recipientIds =
      await this.notificationService.userIdsForArea('recepcion');

    await this.notificationService.createNotificationForUsers(recipientIds, {
      type: 'order_status_changed',
      title,
      body,
      orderId,
    });

    this.notificationsGateway.notifyOrderStatusChangedToRecepcion({
      orderId,
      changedByUsername,
      previousStatus: previousStatusName,
      newStatus: newStatusName,
      changedAt,
    });
  }

  async update(
    id: number,
    updateOrderDto: UpdateOrderDto,
    requestingUserId?: number,
    requestingUser?: RequestingUser,
  ) {
    try {
      const {
        clientId,
        clientNameOverride,
        userId,
        statusId,
        area,
        productionArea,
        requiresDesign,
        description,
        deliveryDate,
        orderProducts,
        authorizationFile,
      } = updateOrderDto;
      const hasAssignedUserId = 'assignedUserId' in updateOrderDto;
      const { assignedUserId } = updateOrderDto;

      // `productionArea`/`requiresDesign` solo los puede tocar
      // recepcion/admin/superuser o diseño (ver PRODUCTION_AREA_EDITOR_ROLES),
      // aunque el endpoint PATCH /orders/:id sea accesible por más roles.
      if (
        (productionArea !== undefined || requiresDesign !== undefined) &&
        requestingUser
      ) {
        this.assertCanEditProductionArea(requestingUser);
      }

      if (authorizationFile) {
        await this.assertAuthorizationFileSize(authorizationFile);
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
      if (productionArea !== undefined) {
        noteChange(
          'productionArea',
          existingOrder.productionArea,
          productionArea,
        );
      }
      if (requiresDesign !== undefined) {
        noteChange(
          'requiresDesign',
          existingOrder.requiresDesign,
          requiresDesign,
        );
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
        ...(productionArea !== undefined && { productionArea }),
        ...(requiresDesign !== undefined && { requiresDesign }),
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
              customName: op.customName.trim(),
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
          user: CREATOR_USER_SELECT,
          assignedUser: ASSIGNED_USER_SELECT,
          status: true,
          orderProducts: true,
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

        // Persistencia + WS: Recepción (y el usuario asignado, si lo hay)
        // reciben la notificación específica de cambio de estado, con su
        // propio tipo `order_status_changed` para que el panel la muestre
        // con su etiqueta propia ("Cambio de estado"). `statusId` queda
        // deliberadamente fuera de `auditChanges`, así que la notificación
        // genérica `area_user_updated_order` nunca duplica este evento.
        await this.notifyOrderStatusChanged(
          updatedOrder.id,
          existingOrder.status.name,
          updatedOrder.status.name,
          updatedOrder.assignedUserId,
          requestingUser,
        );
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

      // Feature: notificación genérica a Recepción cuando un usuario de un
      // área operativa (rol puramente operativo, no admin/superuser/
      // recepcion) cambia un campo relevante del pedido. No duplica las
      // notificaciones puntuales del flujo de diseño (montaje/feedback/
      // autorizado), que siguen teniendo su propio tipo/evento.
      if (
        Object.keys(auditChanges).length > 0 &&
        requestingUser &&
        !isFullVisibilityRole(requestingUser.roles) &&
        operationalRolesOf(requestingUser.roles).length > 0
      ) {
        await this.notifyAreaUserUpdatedOrder(
          updatedOrder.id,
          requestingUser,
          auditChanges,
        );
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

  /**
   * POST /orders/bulk-actions: aplica un cambio de estado y/o área a varios
   * pedidos a la vez. Mismo criterio de acceso que PATCH /orders/:id
   * (assertOrderAccess por pedido): un id sin acceso (o inexistente) se
   * reporta como fallo individual y NO entra a la transacción, en vez de
   * abortar el resto del batch.
   *
   * Atomicidad: los pedidos que sí pasan la validación previa se actualizan
   * en una única `$transaction` -- o se aplican todos, o (si Prisma tira un
   * error a mitad de camino, ej. un statusId que deja de existir entre la
   * validación y el commit) no se aplica ninguno. Los resultados por id
   * reflejan eso: si la transacción falla, todos los ids que iban a
   * actualizarse pasan a `success: false` con el motivo del error.
   */
  async bulkUpdateStatusOrArea(
    dto: BulkOrderActionDto,
    requestingUser: RequestingUser,
  ): Promise<{
    results: Array<{ orderId: number; success: boolean; error?: string }>;
  }> {
    if (dto.statusId === undefined && dto.area === undefined) {
      throw new HttpException(
        'Debe indicarse statusId y/o area',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (dto.area !== undefined) {
      this.assertCanEditProductionArea(requestingUser);
    }

    const results: Array<{
      orderId: number;
      success: boolean;
      error?: string;
    }> = [];
    const acceptedIds: number[] = [];

    // Validación previa (acceso + existencia) por id, fuera de la
    // transacción: así un id inválido no aborta el batch completo, sólo
    // queda afuera de él.
    for (const orderId of dto.orderIds) {
      try {
        await this.assertOrderAccess(orderId, requestingUser);
        acceptedIds.push(orderId);
      } catch (error) {
        results.push({
          orderId,
          success: false,
          error:
            error instanceof HttpException
              ? ((error.getResponse() as { message?: string })?.message ??
                error.message)
              : 'No se pudo validar el acceso al pedido',
        });
      }
    }

    if (acceptedIds.length > 0) {
      const data: Prisma.OrderUpdateInput = {
        ...(dto.statusId !== undefined && {
          status: { connect: { id: dto.statusId } },
        }),
        ...(dto.area !== undefined && { area: dto.area }),
      };

      try {
        await this.prisma.$transaction(
          acceptedIds.map((orderId) =>
            this.prisma.order.update({ where: { id: orderId }, data }),
          ),
        );
        for (const orderId of acceptedIds) {
          results.push({ orderId, success: true });
        }
      } catch (error) {
        const message =
          error.code === 'P2025'
            ? 'Orden no encontrada'
            : error.code === 'P2003'
              ? 'ID de estado inválido'
              : 'No se pudo aplicar el cambio';
        for (const orderId of acceptedIds) {
          results.push({ orderId, success: false, error: message });
        }
      }
    }

    await this.auditLogService.record({
      actorUserId: requestingUser.userId,
      action: 'order.bulk_status_area_update',
      entityType: 'order_bulk',
      entityId: 'bulk',
      metadata: {
        requestedOrderIds: dto.orderIds,
        statusId: dto.statusId,
        area: dto.area,
        results,
      },
    });

    // Mantiene el orden pedido por el cliente en la respuesta.
    const byId = new Map(results.map((r) => [r.orderId, r]));
    return {
      results: dto.orderIds.map(
        (orderId) =>
          byId.get(orderId) ?? {
            orderId,
            success: false,
            error: 'No se pudo procesar el pedido',
          },
      ),
    };
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
      const entries = await this.prisma.orderAuditLog.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
      });
      return this.withAuditLabels(entries);
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

    return buildPaginatedResult(
      await this.withAuditLabels(data),
      total,
      page,
      limit,
    );
  }

  /** Campos del diff de auditoría cuyo valor es el id de otra entidad. */
  private static readonly AUDIT_ID_FIELDS = {
    statusId: 'statuses',
    assignedUserId: 'users',
    clientId: 'clients',
  } as const;

  /**
   * Extrae los ids referenciados por un valor del diff de auditoría. El
   * `changes` puede venir en forma de diff (`{ campo: { before, after } }`,
   * acción `updated`) o plano (`{ statusId, round, ... }`, acciones del flujo
   * de diseño), así que se contemplan las dos.
   */
  private collectAuditIds(
    changes: unknown,
    buckets: Record<'statuses' | 'users' | 'clients', Set<number>>,
  ) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      return;
    }
    for (const [field, raw] of Object.entries(
      changes as Record<string, unknown>,
    )) {
      const bucket = OrderService.AUDIT_ID_FIELDS[field];
      if (!bucket) continue;
      const values =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? [
              (raw as { before?: unknown }).before,
              (raw as { after?: unknown }).after,
            ]
          : [raw];
      for (const value of values) {
        if (typeof value === 'number' && Number.isInteger(value)) {
          buckets[bucket].add(value);
        }
      }
    }
  }

  /**
   * Agrega a cada entrada de auditoría un diccionario `labels` con los nombres
   * de los estados / usuarios / clientes referenciados en `changes`, para que
   * el historial se pueda redactar con nombres y no con ids sin pedir los
   * catálogos aparte (una sola respuesta, sin roundtrips extra, y consistente
   * aun para catálogos que el rol de turno no pueda listar). Los ids que ya no
   * existen (p. ej. un estado eliminado) simplemente no aparecen en el
   * diccionario y el frontend los degrada.
   */
  private async withAuditLabels<T extends { changes: unknown }>(
    entries: T[],
  ): Promise<(T & { labels: Record<string, Record<string, string>> })[]> {
    const buckets = {
      statuses: new Set<number>(),
      users: new Set<number>(),
      clients: new Set<number>(),
    };
    for (const entry of entries) {
      this.collectAuditIds(entry.changes, buckets);
    }

    const [statuses, users, clients] = await Promise.all([
      buckets.statuses.size
        ? this.prisma.status.findMany({
            where: { id: { in: [...buckets.statuses] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      buckets.users.size
        ? this.prisma.user.findMany({
            where: { id: { in: [...buckets.users] } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true,
            },
          })
        : Promise.resolve([]),
      buckets.clients.size
        ? this.prisma.client.findMany({
            where: { id: { in: [...buckets.clients] } },
            select: { id: true, first_name: true, last_name: true },
          })
        : Promise.resolve([]),
    ]);

    const labels: Record<string, Record<string, string>> = {
      statuses: Object.fromEntries(statuses.map((s) => [s.id, s.name])),
      users: Object.fromEntries(
        users.map((u) => [
          u.id,
          [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
            u.username,
        ]),
      ),
      clients: Object.fromEntries(
        clients.map((c) => [
          c.id,
          [c.first_name, c.last_name].filter(Boolean).join(' ').trim(),
        ]),
      ),
    };

    return entries.map((entry) => ({ ...entry, labels }));
  }

  /** Select liviano de una `DesignRevision`, sin los blobs base64 de archivo. */
  private designRevisionListSelect() {
    return {
      id: true,
      orderId: true,
      round: true,
      montageFileName: true,
      montageFileMime: true,
      sentAt: true,
      sentByUserId: true,
      feedbackText: true,
      feedbackFileName: true,
      feedbackFileMime: true,
      feedbackAt: true,
      feedbackByUserId: true,
      approved: true,
      approvedAt: true,
      approvedByUserId: true,
      createdAt: true,
    } satisfies Prisma.DesignRevisionSelect;
  }

  private toDesignRevisionListItem(revision: {
    montageFileName: string | null;
    feedbackFileName: string | null;
    [key: string]: unknown;
  }) {
    return {
      ...revision,
      hasMontageFile: revision.montageFileName != null,
      hasFeedbackFile: revision.feedbackFileName != null,
    };
  }

  /** Trae el pedido (o lanza 404), validando acceso del usuario. */
  private async getOrderOrThrow(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);
    }
    return order;
  }

  /** Trae una `DesignRevision` de un pedido puntual (o lanza 404). */
  private async getDesignRevisionOrThrow(orderId: number, revisionId: number) {
    const revision = await this.prisma.designRevision.findUnique({
      where: { id: revisionId },
    });
    if (!revision || revision.orderId !== orderId) {
      throw new HttpException(
        'Ronda de diseño no encontrada',
        HttpStatus.NOT_FOUND,
      );
    }
    return revision;
  }

  /**
   * POST /orders/:id/design-revisions — Diseño arma una nueva ronda (montaje)
   * y el pedido pasa a "esperando autorización". Notifica a Recepción.
   */
  async createDesignRevision(
    orderId: number,
    dto: CreateDesignRevisionDto,
    requestingUser: RequestingUser,
  ) {
    await this.assertOrderAccess(orderId, requestingUser);
    await this.assertAuthorizationFileSize(dto.montageFile);

    const last = await this.prisma.designRevision.findFirst({
      where: { orderId },
      orderBy: { round: 'desc' },
    });
    const round = (last?.round ?? 0) + 1;
    const statusId = await this.resolveStatusIdByName(
      STATUS_NAME_ESPERANDO_AUTORIZACION,
    );

    const [revision] = await this.prisma.$transaction([
      this.prisma.designRevision.create({
        data: {
          round,
          montageFileData: dto.montageFile.data,
          montageFileName: dto.montageFile.filename,
          montageFileMime: dto.montageFile.mimeType,
          sentAt: new Date(),
          order: { connect: { id: orderId } },
          sentByUser: { connect: { id: requestingUser.userId } },
        },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: { status: { connect: { id: statusId } } },
      }),
      this.prisma.orderAuditLog.create({
        data: {
          action: 'design_montage_sent',
          changes: { round, statusId } as Prisma.InputJsonValue,
          order: { connect: { id: orderId } },
          user: { connect: { id: requestingUser.userId } },
        },
      }),
    ]);

    const recepcionUserIds =
      await this.notificationService.userIdsForArea('recepcion');
    await this.notificationService.createNotificationForUsers(
      recepcionUserIds,
      {
        type: 'design_montage_sent',
        title: 'Montaje listo para enviar al cliente',
        body: `Pedido #${orderId}: nuevo montaje (ronda ${round}) listo para enviar al cliente`,
        orderId,
      },
    );
    this.notificationsGateway.notifyNewOrderToArea('recepcion', {
      orderId,
      description: `Montaje ronda ${round} listo para enviar al cliente`,
      area: 'recepcion',
      deliveryDate: null,
    });

    const created = await this.prisma.designRevision.findUnique({
      where: { id: revision.id },
      select: this.designRevisionListSelect(),
    });
    return this.toDesignRevisionListItem(created);
  }

  /**
   * PATCH /orders/:id/design-revisions/:revisionId/feedback — Recepción
   * carga lo que dijo el cliente. El pedido vuelve a "cambios solicitados"
   * y a área 'diseno'. Notifica a Diseño.
   */
  async addDesignFeedback(
    orderId: number,
    revisionId: number,
    dto: AddDesignFeedbackDto,
    requestingUser: RequestingUser,
  ) {
    await this.assertOrderAccess(orderId, requestingUser);
    const existingRevision = await this.getDesignRevisionOrThrow(
      orderId,
      revisionId,
    );
    if (dto.feedbackFile) {
      await this.assertAuthorizationFileSize(dto.feedbackFile);
    }

    const statusId = await this.resolveStatusIdByName(
      STATUS_NAME_CAMBIOS_SOLICITADOS,
    );

    // El pedido vuelve al mismo diseñador que hizo esa ronda, que es quien
    // conoce el montaje (WORKFLOW.md §2). Recepción puede redirigirlo después
    // con el PATCH normal del pedido si esa persona no está disponible.
    const previousDesignerId = existingRevision.sentByUserId ?? undefined;

    const [revision] = await this.prisma.$transaction([
      this.prisma.designRevision.update({
        where: { id: revisionId },
        data: {
          feedbackText: dto.feedbackText,
          feedbackAt: new Date(),
          feedbackByUser: { connect: { id: requestingUser.userId } },
          ...(dto.feedbackFile && {
            feedbackFileData: dto.feedbackFile.data,
            feedbackFileName: dto.feedbackFile.filename,
            feedbackFileMime: dto.feedbackFile.mimeType,
          }),
        },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          area: 'diseno',
          status: { connect: { id: statusId } },
          ...(previousDesignerId && {
            assignedUser: { connect: { id: previousDesignerId } },
          }),
        },
      }),
      this.prisma.orderAuditLog.create({
        data: {
          action: 'design_feedback_added',
          changes: {
            revisionId,
            statusId,
            feedbackText: dto.feedbackText,
          } as Prisma.InputJsonValue,
          order: { connect: { id: orderId } },
          user: { connect: { id: requestingUser.userId } },
        },
      }),
    ]);

    const disenoUserIds =
      await this.notificationService.userIdsForArea('diseno');
    await this.notificationService.createNotificationForUsers(disenoUserIds, {
      type: 'design_feedback_added',
      title: 'El cliente pidió cambios',
      body: `Pedido #${orderId}: el cliente pidió cambios sobre el montaje`,
      orderId,
    });
    this.notificationsGateway.notifyNewOrderToArea('diseno', {
      orderId,
      description: 'El cliente pidió cambios sobre el montaje',
      area: 'diseno',
      deliveryDate: null,
    });

    const updated = await this.prisma.designRevision.findUnique({
      where: { id: revision.id },
      select: this.designRevisionListSelect(),
    });
    return this.toDesignRevisionListItem(updated);
  }

  /**
   * PATCH /orders/:id/design-revisions/:revisionId/approve — Recepción marca
   * que el cliente autorizó. El pedido pasa a "autorizado" y su `area` se
   * mueve a `productionArea` (del body, o ya fijada en el pedido).
   */
  async approveDesignRevision(
    orderId: number,
    revisionId: number,
    dto: ApproveDesignRevisionDto,
    requestingUser: RequestingUser,
  ) {
    await this.assertOrderAccess(orderId, requestingUser);
    await this.getDesignRevisionOrThrow(orderId, revisionId);
    const order = await this.getOrderOrThrow(orderId);

    // Áreas que van a producir el pedido. Pueden ser varias y trabajan en
    // paralelo (WORKFLOW.md §3): las define Diseño acá, o vienen planificadas
    // por Recepción desde el alta como tareas ya creadas.
    const plannedTasks = await this.orderAreaTaskService.findByOrder(orderId);
    const resolvedAreas =
      dto.productionAreas && dto.productionAreas.length > 0
        ? (dto.productionAreas as string[])
        : plannedTasks.length > 0
          ? plannedTasks.map((task) => task.area)
          : ([dto.productionArea ?? order.productionArea].filter(
              Boolean,
            ) as string[]);

    if (resolvedAreas.length === 0) {
      throw new HttpException(
        'Definir el área de producción antes de autorizar',
        HttpStatus.BAD_REQUEST,
      );
    }
    // `productionArea` (singular) se mantiene como el área "principal" para
    // toda la lógica existente de visibilidad y listados.
    const productionArea = dto.productionArea ?? resolvedAreas[0];

    const statusId = await this.resolveStatusIdByName(STATUS_NAME_AUTORIZADO);

    const [revision] = await this.prisma.$transaction([
      this.prisma.designRevision.update({
        where: { id: revisionId },
        data: {
          approved: true,
          approvedAt: new Date(),
          approvedByUser: { connect: { id: requestingUser.userId } },
        },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          area: productionArea,
          productionArea,
          status: { connect: { id: statusId } },
          // El diseñador deja de ser el responsable del pedido: a partir de acá
          // manda cada tarea de área con su propio asignado (WORKFLOW.md §3).
          // Queda registrado abajo en la auditoría y en las rondas de montaje.
          assignedUser: { disconnect: true },
        },
      }),
      this.prisma.orderAuditLog.create({
        data: {
          action: 'design_approved',
          changes: {
            revisionId,
            statusId,
            productionArea,
            productionAreas: resolvedAreas,
            // Quién venía trabajando el montaje, para no perder el rastro al
            // liberar `assignedUserId`.
            previousAssignedUserId: order.assignedUserId ?? null,
          } as Prisma.InputJsonValue,
          order: { connect: { id: orderId } },
          user: { connect: { id: requestingUser.userId } },
        },
      }),
    ]);

    // Crea las tareas de las áreas que falten (idempotente: las planificadas
    // desde el alta ya existen y no se duplican).
    await this.orderAreaTaskService.createTasksForAreas(
      orderId,
      resolvedAreas,
      {
        notify: false,
      },
    );

    // Recién ahora hay trabajo real para producción: se avisa a cada área
    // involucrada, sólo de lo suyo.
    for (const area of resolvedAreas) {
      const areaUserIds = await this.notificationService.userIdsForArea(area);
      await this.notificationService.createNotificationForUsers(areaUserIds, {
        type: 'design_approved',
        title: 'Diseño autorizado, listo para producción',
        body: `Pedido #${orderId}: diseño autorizado, pasa a ${area}`,
        orderId,
      });
      this.notificationsGateway.notifyNewOrderToArea(area, {
        orderId,
        description: `Diseño autorizado, pedido listo para producción en ${area}`,
        area,
        deliveryDate: null,
      });
    }

    const updated = await this.prisma.designRevision.findUnique({
      where: { id: revision.id },
      select: this.designRevisionListSelect(),
    });
    return this.toDesignRevisionListItem(updated);
  }

  /** GET /orders/:id/design-revisions — rondas ordenadas asc, sin blobs. */
  async getDesignRevisions(orderId: number, requestingUser: RequestingUser) {
    await this.assertOrderAccess(orderId, requestingUser);
    const revisions = await this.prisma.designRevision.findMany({
      where: { orderId },
      select: this.designRevisionListSelect(),
      orderBy: { round: 'asc' },
    });
    return revisions.map((r) => this.toDesignRevisionListItem(r));
  }

  /** GET /orders/:id/design-revisions/:revisionId/montage */
  async getDesignRevisionMontageFile(
    orderId: number,
    revisionId: number,
    requestingUser: RequestingUser,
  ) {
    await this.assertOrderAccess(orderId, requestingUser);
    const revision = await this.getDesignRevisionOrThrow(orderId, revisionId);
    if (!revision.montageFileData) {
      throw new HttpException(
        'Esta ronda no tiene montaje cargado',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      filename: revision.montageFileName,
      mimeType: revision.montageFileMime,
      dataUrl: `data:${revision.montageFileMime};base64,${revision.montageFileData}`,
    };
  }

  /** GET /orders/:id/design-revisions/:revisionId/feedback-file */
  async getDesignRevisionFeedbackFile(
    orderId: number,
    revisionId: number,
    requestingUser: RequestingUser,
  ) {
    await this.assertOrderAccess(orderId, requestingUser);
    const revision = await this.getDesignRevisionOrThrow(orderId, revisionId);
    if (!revision.feedbackFileData) {
      throw new HttpException(
        'Esta ronda no tiene archivo de feedback',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      filename: revision.feedbackFileName,
      mimeType: revision.feedbackFileMime,
      dataUrl: `data:${revision.feedbackFileMime};base64,${revision.feedbackFileData}`,
    };
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

    if (requestingUser) {
      await this.auditLogService.record({
        actorUserId: requestingUser.userId,
        action: 'order.csv_export',
        entityType: 'order_export',
        entityId: 'bulk',
        metadata: { filters, exportedCount: visible.length },
      });
    }

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
