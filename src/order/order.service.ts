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

/** Tamaño máximo (en bytes, ya decodificado) para la hoja de autorización. */
const MAX_AUTHORIZATION_FILE_BYTES = 5 * 1024 * 1024;

@Injectable()
export class OrderService {
  constructor(
    private prisma: PrismaService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

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
  async findAll(query?: PaginationQueryDto) {
    try {
      const select = {
        id: true,
        clientId: true,
        userId: true,
        statusId: true,
        description: true,
        creationDate: true,
        deliveryDate: true,
        authorizationFileName: true,
        client: true,
        user: true,
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
        return orders.map(toListItem);
      }

      const [data, total] = await this.prisma.$transaction([
        this.prisma.order.findMany({
          select,
          skip,
          take: limit,
          orderBy: { id: 'desc' },
        }),
        this.prisma.order.count(),
      ]);

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
