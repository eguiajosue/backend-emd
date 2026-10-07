import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import {
  buildPaginatedResult,
  resolvePagination,
} from 'src/common/dto/pagination-query.dto';
import { ClientListQueryDto } from './dto/client-list-query.dto';
import {
  BRANCH_BADGE_SELECT,
  branchOfUser,
  isBranchOnlyUser,
} from 'src/branch/branch-access';

/** Usuario que hace la petición (para acotar clientes por sucursal). */
export interface ClientRequestingUser {
  userId: number;
  roles: string[];
}

/** Cliente con su empresa y su sucursal dueña (`branch` null = matriz). */
const CLIENT_INCLUDE = {
  company: true,
  branch: BRANCH_BADGE_SELECT,
} satisfies Prisma.ClientInclude;

@Injectable()
export class ClientService {
  constructor(private prisma: PrismaService) {}

  /**
   * Cada sucursal tiene sus propios clientes: si crea una cuenta sólo-sucursal
   * el cliente queda en SU sucursal (se ignora cualquier `branchId` del body);
   * los de la matriz se crean con `branchId` null, como siempre.
   */
  async create(
    createClientDto: CreateClientDto,
    requestingUser?: ClientRequestingUser,
  ) {
    try {
      // Nunca se confía en un `branchId` que venga en el body.
      const data: CreateClientDto & { branchId?: unknown } = {
        ...createClientDto,
      };
      delete data.branchId;
      const branchId =
        requestingUser && isBranchOnlyUser(requestingUser.roles)
          ? (await branchOfUser(this.prisma, requestingUser.userId)).id
          : null;
      const client = await this.prisma.client.create({
        data: { ...data, branchId } as Prisma.ClientUncheckedCreateInput,
        include: CLIENT_INCLUDE,
      });
      return client;
    } catch (error) {
      if (error.code === 'P2003') {
        // Fallo en restricción de clave foránea
        throw new HttpException(
          'ID de empresa inválido',
          HttpStatus.BAD_REQUEST,
        );
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  /**
   * Paginación OPT-IN (ver PaginationQueryDto). La cuenta sólo-sucursal ve
   * únicamente los clientes de su sucursal; la matriz ve todos y puede filtrar
   * con `branchId` o `scope`.
   */
  async findAll(
    query?: ClientListQueryDto,
    requestingUser?: ClientRequestingUser,
  ) {
    try {
      const include = CLIENT_INCLUDE;
      const { enabled, page, limit, skip } = resolvePagination(query);
      const where = await this.listWhere(query, requestingUser);

      if (!enabled) {
        return await this.prisma.client.findMany({ where, include });
      }

      const [data, total] = await this.prisma.$transaction([
        this.prisma.client.findMany({
          where,
          include,
          skip,
          take: limit,
          orderBy: { id: 'asc' },
        }),
        this.prisma.client.count({ where }),
      ]);

      return buildPaginatedResult(data, total, page, limit);
    } catch (error) {
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }

  private async listWhere(
    query?: ClientListQueryDto,
    requestingUser?: ClientRequestingUser,
  ): Promise<Prisma.ClientWhereInput> {
    if (requestingUser && isBranchOnlyUser(requestingUser.roles)) {
      // Los filtros del query se ignoran: la sucursal sólo ve lo suyo.
      const branch = await branchOfUser(this.prisma, requestingUser.userId);
      return { branchId: branch.id };
    }
    if (query?.branchId) return { branchId: query.branchId };
    if (query?.scope === 'matriz') return { branchId: null };
    if (query?.scope === 'sucursal') return { branchId: { not: null } };
    return {};
  }

  /**
   * Una cuenta sólo-sucursal únicamente puede tocar clientes de su sucursal:
   * uno de la matriz o de otra sucursal responde 403 (igual que un pedido
   * ajeno). Para la matriz no restringe nada.
   */
  private async assertClientAccess(
    client: { branchId: number | null },
    requestingUser?: ClientRequestingUser,
  ) {
    if (!requestingUser || !isBranchOnlyUser(requestingUser.roles)) return;
    const branch = await branchOfUser(this.prisma, requestingUser.userId);
    if (client.branchId !== branch.id) {
      throw new HttpException(
        'No tienes acceso a este cliente',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async findOne(id: number, requestingUser?: ClientRequestingUser) {
    try {
      const client = await this.prisma.client.findUnique({
        where: { id },
        include: CLIENT_INCLUDE,
      });
      if (!client) {
        throw new HttpException('Cliente no encontrado', HttpStatus.NOT_FOUND);
      }
      await this.assertClientAccess(client, requestingUser);
      return client;
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
    updateClientDto: UpdateClientDto,
    requestingUser?: ClientRequestingUser,
  ) {
    try {
      // La sucursal dueña no se cambia por la API de edición.
      const data: UpdateClientDto & { branchId?: unknown } = {
        ...updateClientDto,
      };
      delete data.branchId;
      if (requestingUser && isBranchOnlyUser(requestingUser.roles)) {
        const existing = await this.prisma.client.findUnique({
          where: { id },
          select: { branchId: true },
        });
        if (!existing) {
          throw new HttpException(
            'Cliente no encontrado',
            HttpStatus.NOT_FOUND,
          );
        }
        await this.assertClientAccess(existing, requestingUser);
      }
      const client = await this.prisma.client.update({
        where: { id },
        data: data as Prisma.ClientUncheckedUpdateInput,
        include: CLIENT_INCLUDE,
      });
      return client;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException('Cliente no encontrado', HttpStatus.NOT_FOUND);
      }
      if (error.code === 'P2003') {
        // Fallo en restricción de clave foránea
        throw new HttpException(
          'ID de empresa inválido',
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
      await this.prisma.client.delete({
        where: { id },
      });
      return { message: 'Cliente eliminado correctamente' };
    } catch (error) {
      if (error.code === 'P2025') {
        // Registro no encontrado
        throw new HttpException('Cliente no encontrado', HttpStatus.NOT_FOUND);
      }
      // Errores desconocidos: los maneja AllExceptionsFilter, que no expone
      // detalles internos (Prisma, stack) al cliente en producción.
      throw error;
    }
  }
}
