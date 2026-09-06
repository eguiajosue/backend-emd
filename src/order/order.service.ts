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
import {
  isFullVisibilityRole,
  operationalRolesOf,
  roleStageMapping,
} from './role-stage-mapping';

/** Roles + id del usuario autenticado, usados para filtrar pedidos por área. */
export interface RequestingUser {
  userId: number;
  roles: string[];
}

/** Tamaño máximo (en bytes, ya decodificado) para la hoja de autorización. */
const MAX_AUTHORIZATION_FILE_BYTES = 5 * 1024 * 1024;

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
  },
} satisfies { select: Prisma.UserSelect };

@Injectable()
export class OrderService {
  constructor(
    private prisma: PrismaService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly areaVisibilityService: AreaVisibilityService,
  ) {}

  /**
   * Filtra los pedidos según el área/rol del usuario autenticado.
   *
   * - admin/superuser/recepcion: ven todo, sin cambios.
   * - Roles puramente operativos: por cada rol operativo del usuario, si su
   *   AreaVisibilitySetting.generalViewEnabled es true, todos los pedidos de
   *   la(s) etapa(s) de ese rol quedan visibles. Si es false, de esa etapa
   *   solo quedan visibles los pedidos sin asignar (assignedUserId null) o
   *   asignados al propio usuario. Un pedido cuya etapa no corresponde a
   *   ningún rol del usuario no se incluye.
   */
  private async filterOrdersForUser<
    T extends { status: { name: string }; assignedUserId: number | null },
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

    // Etapas (nombres de status) donde el usuario tiene vista general habilitada.
    const generalViewStages = new Set<string>();
    // Todas las etapas alcanzables por los roles del usuario (con o sin vista general).
    const allUserStages = new Set<string>();
    for (const role of userOperationalRoles) {
      const stages = roleStageMapping[role] || [];
      stages.forEach((stage) => {
        allUserStages.add(stage);
        if (generalViewByRole.get(role) !== false) {
          generalViewStages.add(stage);
        }
      });
    }

    return orders.filter((order) => {
      const stage = order.status?.name;
      if (!stage || !allUserStages.has(stage)) {
        return false;
      }
      if (generalViewStages.has(stage)) {
        return true;
      }
      // Etapa con vista general deshabilitada para todos los roles del
      // usuario que la alcanzan: solo visible si no está asignada o está
      // asignada a este usuario.
      return order.assignedUserId == null || order.assignedUserId === userId;
    });
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
        userId,
        assignedUserId,
        statusId,
        description,
        deliveryDate,
        orderProducts,
        authorizationFile,
      } = createOrderDto;

      if (!clientId || !userId || !statusId) {
        throw new HttpException(
          'Datos faltantes: clientId, userId o statusId',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (authorizationFile) {
        this.assertAuthorizationFileSize(authorizationFile);
      }

      const data: Prisma.OrderCreateInput = {
        description,
        creationDate: new Date(),
        deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
        client: {
          connect: { id: clientId },
        },
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
                product: {
                  connect: { id: op.productId },
                },
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
      if (
        order &&
        order.client &&
        order.user &&
        order.client.first_name &&
        order.user.username
      ) {
        const adminNotificationData = {
          id: order.id,
          description: order.description,
          clientName: order.client.first_name,
          createdBy: order.user.username,
          creationDate: order.creationDate,
          deliveryDate: order.deliveryDate,
        };

        this.notificationsGateway.notifyNewOrderToAdmin(adminNotificationData);
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
  async findAll(query?: PaginationQueryDto, requestingUser?: RequestingUser) {
    try {
      const select = {
        id: true,
        clientId: true,
        userId: true,
        assignedUserId: true,
        statusId: true,
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
      } satisfies Prisma.OrderSelect;
      const { enabled, page, limit, skip } = resolvePagination(query);

      const toListItem = (order: {
        authorizationFileName: string | null;
        [key: string]: unknown;
      }) => {
        const { authorizationFileName, ...rest } = order;
        return {
          ...rest,
          hasAuthorizationFile: authorizationFileName != null,
        };
      };

      if (!enabled) {
        const orders = await this.prisma.order.findMany({ select });
        const visible = await this.filterOrdersForUser(orders, requestingUser);
        return visible.map(toListItem);
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

      return buildPaginatedResult(data.map(toListItem), total, page, limit);
    } catch (error) {
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  async findOne(id: number) {
    try {
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
        },
      });
      if (!order) {
        throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);
      }

      const {
        authorizationFileData,
        authorizationFileName,
        authorizationFileMime,
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

  async update(id: number, updateOrderDto: UpdateOrderDto) {
    try {
      const {
        clientId,
        userId,
        statusId,
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

      const data: Prisma.OrderUpdateInput = {
        ...(description && { description }),
        ...(deliveryDate && { deliveryDate: new Date(deliveryDate) }),
        ...(clientId && {
          client: {
            connect: { id: clientId },
          },
        }),
        ...(userId && {
          user: {
            connect: { id: userId },
          },
        }),
        // assignedUserId es escalar opcional: si viene explícito en el body
        // (incluso `null` para desasignar) lo aplicamos tal cual.
        ...(hasAssignedUserId && { assignedUserId: assignedUserId ?? null }),
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
              product: {
                connect: { id: op.productId },
              },
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
