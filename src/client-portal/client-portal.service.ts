import { randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/storage/storage.service';
import { NotificationService } from 'src/notification/notification.service';
import {
  STATUS_NAME_CAMBIOS_SOLICITADOS,
  STATUS_NAME_CANCELADO,
  STATUS_NAME_EN_DISENO,
  STATUS_NAME_ENTREGADO,
  STATUS_NAME_ESPERANDO_AUTORIZACION,
  STATUS_NAME_TERMINADO,
} from 'src/order/status-id-resolver';
import type { ClientPortalRespondDto } from './dto/client-portal.dto';

/**
 * Portal del cliente (WORKFLOW.md §8): un enlace privado `/p/<token>` para que
 * el cliente vea en qué va su pedido, sus productos y tallas, y el diseño a
 * aprobar. Su respuesta NO cambia el pedido: queda pendiente y Recepción la
 * confirma con el flujo de siempre (autorizar con hoja de materiales, o cargar
 * el feedback), que la marca como aplicada (`resolvePendingResponses`).
 */

/** El enlace sigue sirviendo hasta 30 días después de la entrega. */
export const PORTAL_LINK_DAYS_AFTER_DELIVERY = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const CLIENT_RESPONSE_KINDS = ['aprobar', 'cambios'] as const;
export type ClientResponseKind = (typeof CLIENT_RESPONSE_KINDS)[number];

export type PortalStageKey =
  | 'diseno'
  | 'autorizacion'
  | 'produccion'
  | 'listo'
  | 'entregado'
  | 'cancelado';

const STAGE_LABEL: Record<PortalStageKey, string> = {
  diseno: 'Diseño',
  autorizacion: 'Tu aprobación',
  produccion: 'Producción',
  listo: 'Listo para entregar',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

const REVISION_FILE_KIND_MONTAGE = 'montage';

/** Respuesta del cliente tal como la ven el portal y Recepción. */
const RESPONSE_SELECT = {
  id: true,
  revisionId: true,
  kind: true,
  comment: true,
  status: true,
  createdAt: true,
} as const;

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

@Injectable()
export class ClientPortalService {
  private readonly logger = new Logger(ClientPortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notificationService: NotificationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Recepción: crear, regenerar y revocar el enlace
  // ---------------------------------------------------------------------------

  private async assertOrderExists(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true },
    });
    if (!order) {
      throw new HttpException('Pedido no encontrado', HttpStatus.NOT_FOUND);
    }
  }

  /** Estado del enlace y la respuesta del cliente pendiente de confirmar. */
  async getShareState(orderId: number) {
    await this.assertOrderExists(orderId);
    const [link, pendingResponse] = await Promise.all([
      this.prisma.orderShareLink.findUnique({
        where: { orderId },
        select: {
          token: true,
          createdAt: true,
          lastViewedAt: true,
          viewCount: true,
        },
      }),
      this.prisma.clientDesignResponse.findFirst({
        where: { orderId, status: 'pendiente' },
        select: RESPONSE_SELECT,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { link, pendingResponse };
  }

  /** Crea el enlace la primera vez; si ya existe lo devuelve tal cual. */
  async ensureLink(orderId: number, userId: number) {
    await this.assertOrderExists(orderId);
    await this.prisma.orderShareLink.upsert({
      where: { orderId },
      create: { orderId, token: newToken(), createdById: userId },
      update: {},
    });
    return this.getShareState(orderId);
  }

  /** Cambia el token: el enlace anterior deja de funcionar. */
  async regenerateLink(orderId: number, userId: number) {
    await this.assertOrderExists(orderId);
    await this.prisma.orderShareLink.upsert({
      where: { orderId },
      create: { orderId, token: newToken(), createdById: userId },
      update: {
        token: newToken(),
        createdById: userId,
        createdAt: new Date(),
        lastViewedAt: null,
        viewCount: 0,
      },
    });
    return this.getShareState(orderId);
  }

  async revokeLink(orderId: number) {
    await this.assertOrderExists(orderId);
    await this.prisma.orderShareLink.deleteMany({ where: { orderId } });
    return { revoked: true };
  }

  /** Recepción decide no aplicar lo que respondió el cliente. */
  async discardResponse(orderId: number, responseId: number, userId: number) {
    const { count } = await this.prisma.clientDesignResponse.updateMany({
      where: { id: responseId, orderId, status: 'pendiente' },
      data: {
        status: 'descartada',
        resolvedAt: new Date(),
        resolvedById: userId,
      },
    });
    if (count === 0) {
      throw new HttpException(
        'Esa respuesta ya no está pendiente',
        HttpStatus.CONFLICT,
      );
    }
    return { discarded: true };
  }

  // ---------------------------------------------------------------------------
  // Público: lo que ve el cliente
  // ---------------------------------------------------------------------------

  private async findOrderByToken(token: string) {
    if (!token || token.length < 20 || token.length > 100) this.notFound();
    const link = await this.prisma.orderShareLink.findUnique({
      where: { token },
      select: {
        id: true,
        order: {
          select: {
            id: true,
            description: true,
            deliveryDate: true,
            creationDate: true,
            requiresDesign: true,
            clientNameOverride: true,
            client: { select: { first_name: true, last_name: true } },
            status: { select: { id: true, name: true } },
            branch: {
              select: {
                name: true,
                logoOnLightData: true,
                logoOnLightKey: true,
                logoOnLightMime: true,
              },
            },
            areaTasks: { select: { status: true } },
            orderProducts: {
              select: { customName: true, quantity: true, sizes: true },
              orderBy: { id: 'asc' },
            },
            histories: {
              select: { newStatusId: true, changeDate: true },
              orderBy: { changeDate: 'desc' },
            },
          },
        },
      },
    });
    if (!link) this.notFound();
    const order = link!.order;
    const statusName = order.status.name.toLowerCase();
    if (statusName === STATUS_NAME_ENTREGADO) {
      const delivered = order.histories.find(
        (h) => h.newStatusId === order.status.id,
      );
      const deliveredAt = delivered?.changeDate ?? null;
      if (
        deliveredAt &&
        Date.now() - deliveredAt.getTime() >
          PORTAL_LINK_DAYS_AFTER_DELIVERY * DAY_MS
      ) {
        throw new HttpException(
          'Este enlace ya venció. Pide uno nuevo si lo necesitas.',
          HttpStatus.GONE,
        );
      }
    }
    return { linkId: link!.id, order, statusName };
  }

  private notFound(): never {
    throw new HttpException(
      'Este enlace no existe o ya no está disponible',
      HttpStatus.NOT_FOUND,
    );
  }

  private stageOf(
    statusName: string,
    tasks: { status: string }[],
  ): PortalStageKey {
    if (statusName === STATUS_NAME_CANCELADO) return 'cancelado';
    if (statusName === STATUS_NAME_ENTREGADO) return 'entregado';
    if (
      statusName === STATUS_NAME_EN_DISENO ||
      statusName === STATUS_NAME_CAMBIOS_SOLICITADOS
    ) {
      return 'diseno';
    }
    if (statusName === STATUS_NAME_ESPERANDO_AUTORIZACION) {
      return 'autorizacion';
    }
    const done =
      tasks.length > 0
        ? tasks.every((t) => t.status === 'terminado')
        : statusName === STATUS_NAME_TERMINADO;
    return done ? 'listo' : 'produccion';
  }

  /** Última ronda enviada al cliente (la que se aprueba o se corrige). */
  private async currentRevision(orderId: number) {
    return this.prisma.designRevision.findFirst({
      where: { orderId, sentAt: { not: null } },
      orderBy: { round: 'desc' },
      select: {
        id: true,
        round: true,
        sentAt: true,
        approved: true,
        feedbackText: true,
        files: {
          where: { kind: REVISION_FILE_KIND_MONTAGE },
          orderBy: { position: 'asc' },
          select: { id: true, filename: true, mimeType: true },
        },
      },
    });
  }

  /** GET /portal/:token — el pedido visto por el cliente. Cuenta la visita. */
  async getPortal(token: string) {
    const { linkId, order, statusName } = await this.findOrderByToken(token);
    await this.prisma.orderShareLink.update({
      where: { id: linkId },
      data: { lastViewedAt: new Date(), viewCount: { increment: 1 } },
    });

    const stage = this.stageOf(statusName, order.areaTasks);
    const stageKeys: PortalStageKey[] = [
      ...(order.requiresDesign
        ? (['diseno', 'autorizacion'] as PortalStageKey[])
        : []),
      'produccion',
      'listo',
      'entregado',
    ];

    const revision = order.requiresDesign
      ? await this.currentRevision(order.id)
      : null;
    const awaitingResponse =
      !!revision &&
      statusName === STATUS_NAME_ESPERANDO_AUTORIZACION &&
      !revision.approved &&
      !revision.feedbackText;
    const [mockups, lastResponse] = await Promise.all([
      this.prisma.orderMockup.findMany({
        where: { orderId: order.id },
        select: { id: true, garment: true },
        orderBy: { createdAt: 'asc' },
      }),
      revision
        ? this.prisma.clientDesignResponse.findFirst({
            where: {
              revisionId: revision.id,
              status: { in: ['pendiente', 'aplicada'] },
            },
            select: RESPONSE_SELECT,
            orderBy: { createdAt: 'desc' },
          })
        : null,
    ]);

    const client = order.client
      ? [order.client.first_name, order.client.last_name]
          .filter(Boolean)
          .join(' ')
      : (order.clientNameOverride ?? null);
    const branch = order.branch
      ? {
          name: order.branch.name,
          logo: order.branch.logoOnLightMime
            ? await this.storage
                .loadBase64OrNull({
                  data: order.branch.logoOnLightData,
                  key: order.branch.logoOnLightKey,
                })
                .then((b64) =>
                  b64
                    ? `data:${order.branch!.logoOnLightMime};base64,${b64}`
                    : null,
                )
                .catch(() => null)
            : null,
        }
      : null;

    return {
      order: {
        id: order.id,
        description: order.description,
        clientName: client,
        deliveryDate: order.deliveryDate,
        creationDate: order.creationDate,
        branch,
      },
      stage: { key: stage, label: STAGE_LABEL[stage] },
      stages: stageKeys.map((key) => ({ key, label: STAGE_LABEL[key] })),
      products: order.orderProducts.map((p) => ({
        name: p.customName,
        quantity: p.quantity,
        sizes: p.sizes,
      })),
      design: revision
        ? {
            revisionId: revision.id,
            round: revision.round,
            sentAt: revision.sentAt,
            approved: revision.approved,
            awaitingResponse,
            files: revision.files,
          }
        : null,
      mockups,
      response: lastResponse,
    };
  }

  /** GET /portal/:token/design-files/:fileId — sólo montajes de la ronda actual. */
  async getDesignFile(token: string, fileId: number) {
    const { order } = await this.findOrderByToken(token);
    const revision = await this.currentRevision(order.id);
    const meta = revision?.files.find((f) => f.id === fileId);
    if (!meta) this.notFound();
    const file = await this.prisma.designRevisionFile.findUnique({
      where: { id: fileId },
      select: { filename: true, mimeType: true, data: true, dataKey: true },
    });
    if (!file) this.notFound();
    return {
      filename: file!.filename,
      mimeType: file!.mimeType,
      dataUrl: await this.storage.toDataUrl(file!.mimeType, {
        data: file!.data,
        key: file!.dataKey,
      }),
    };
  }

  /** GET /portal/:token/mockups/:mockupId — lámina del mockup 3D. */
  async getMockupImage(token: string, mockupId: number) {
    const { order } = await this.findOrderByToken(token);
    const mockup = await this.prisma.orderMockup.findFirst({
      where: { id: mockupId, orderId: order.id },
      select: {
        garment: true,
        imageData: true,
        imageKey: true,
        imageMime: true,
      },
    });
    if (!mockup) this.notFound();
    return {
      garment: mockup!.garment,
      mimeType: mockup!.imageMime,
      dataUrl: await this.storage.toDataUrl(mockup!.imageMime, {
        data: mockup!.imageData,
        key: mockup!.imageKey,
      }),
    };
  }

  /**
   * POST /portal/:token/respond — el cliente aprueba o pide cambios. Queda
   * pendiente (reemplaza a otra pendiente) y se le avisa a la recepcionista
   * que atiende el pedido.
   */
  async respond(token: string, dto: ClientPortalRespondDto) {
    const { order, statusName } = await this.findOrderByToken(token);
    const revision = await this.currentRevision(order.id);
    if (
      !revision ||
      statusName !== STATUS_NAME_ESPERANDO_AUTORIZACION ||
      revision.approved ||
      revision.feedbackText
    ) {
      throw new HttpException(
        'Este diseño ya no está esperando tu respuesta. Recarga la página.',
        HttpStatus.CONFLICT,
      );
    }
    const comment = dto.comment?.trim() || null;
    if (dto.kind === 'cambios' && !comment) {
      throw new HttpException(
        'Cuéntanos qué te gustaría cambiar',
        HttpStatus.BAD_REQUEST,
      );
    }

    const [, created] = await this.prisma.$transaction([
      this.prisma.clientDesignResponse.updateMany({
        where: { orderId: order.id, status: 'pendiente' },
        data: { status: 'reemplazada', resolvedAt: new Date() },
      }),
      this.prisma.clientDesignResponse.create({
        data: {
          orderId: order.id,
          revisionId: revision.id,
          kind: dto.kind,
          comment,
        },
        select: RESPONSE_SELECT,
      }),
    ]);

    await this.notifyReception(order.id, dto.kind, comment).catch((error) =>
      this.logger.warn(
        `No se pudo avisar la respuesta del cliente: ${(error as Error).message}`,
      ),
    );
    return { response: created };
  }

  private async notifyReception(
    orderId: number,
    kind: ClientResponseKind,
    comment: string | null,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true, attendedByUserId: true },
    });
    const userId = order?.attendedByUserId ?? order?.userId;
    if (!userId) return;
    const short =
      comment && comment.length > 120 ? `${comment.slice(0, 117)}…` : comment;
    await this.notificationService.createNotification({
      userId,
      type: 'client_portal_response',
      title:
        kind === 'aprobar'
          ? 'El cliente aprobó el diseño'
          : 'El cliente pidió cambios',
      body:
        kind === 'aprobar'
          ? `Pedido #${orderId}: aprobó desde su enlace. Confírmalo para pasar a producción.`
          : `Pedido #${orderId}: "${short}". Confírmalo para mandarlo a Diseño.`,
      orderId,
    });
  }
}
