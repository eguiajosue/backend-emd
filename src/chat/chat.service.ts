import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildPaginatedResult,
  PaginationQueryDto,
  resolvePagination,
} from 'src/common/dto/pagination-query.dto';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { Role } from 'src/common/enums/roles.enum';
import { OrderService } from 'src/order/order.service';
import { assertBase64FileValid } from 'src/common/file-validation';
import {
  ChatAttachmentDto,
  CHAT_ATTACHMENT_MIME_TYPES,
} from './dto/send-message.dto';
import {
  CHAT_AREAS,
  CHAT_CONVERSATION_TYPE_AREA,
  CHAT_CONVERSATION_TYPE_DIRECT,
  chatAreaLabel,
  isMonitorRole,
} from './chat.constants';

/** Tamaño máximo (en bytes, ya decodificado) para un adjunto de chat. Mismo
 * límite que la hoja de autorización de pedidos (ver order.service.ts). */
const MAX_CHAT_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Selección de columnas de adjunto reusada en varios lados. */
const MESSAGE_ATTACHMENT_SELECT = {
  attachmentFilename: true,
  attachmentMimeType: true,
  attachmentSize: true,
} as const;

/** Forma cruda de un mensaje leído de la DB, con o sin `attachmentData`. */
interface MessageAttachmentFields {
  attachmentFilename: string | null;
  attachmentMimeType: string | null;
  attachmentSize: number | null;
  attachmentData?: string | null;
}

/**
 * Arma el objeto `attachment` expuesto en las respuestas/eventos de chat a
 * partir de las columnas crudas de `ChatMessage`. Sigue el mismo patrón que
 * `OrderService.findOne` con `authorizationFile`: el binario en base64 se
 * expone como `dataUrl` (`data:<mime>;base64,<...>`), listo para usar en un
 * `<img>`/`<audio>`/link de descarga en el cliente.
 */
function toAttachmentDto(message: MessageAttachmentFields) {
  if (!message.attachmentFilename || !message.attachmentMimeType) {
    return null;
  }
  return {
    filename: message.attachmentFilename,
    mimeType: message.attachmentMimeType,
    size: message.attachmentSize,
    ...(message.attachmentData != null && {
      dataUrl: `data:${message.attachmentMimeType};base64,${message.attachmentData}`,
    }),
  };
}

/** Resumen de pedido adjuntado a un mensaje, sólo lo necesario para la burbuja. */
const MESSAGE_ORDER_SELECT = {
  id: true,
  description: true,
  area: true,
  status: { select: { name: true } },
} as const;

/** Usuario autenticado que hace la consulta (subset del AccessTokenPayload). */
export interface ChatRequestingUser {
  userId: number;
  roles: string[];
}

/** Forma mínima de conversación necesaria para resolver autorización. */
interface ConversationCore {
  id: number;
  type: string;
  area: string | null;
  directUserAId: number | null;
  directUserBId: number | null;
}

const USER_SUMMARY_SELECT = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
} as const;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly orderService: OrderService,
  ) {}

  // ---------------------------------------------------------------------
  // Autorización
  // ---------------------------------------------------------------------

  /**
   * Reglas de pertenencia, resueltas SIEMPRE en el servidor a partir de la
   * conversación y de los roles del usuario (nunca del id que manda el
   * cliente). Mismo espíritu que `OrderService.assertOrderAccess()`.
   *
   * - admin / superuser: miembros de TODOS los canales de área (monitoreo).
   *   NO son miembros automáticos de los mensajes directos ajenos: en un DM
   *   sólo entran si son alguno de los dos participantes.
   * - canal de área: los usuarios con ese rol de área + todos los de recepción.
   * - mensaje directo: únicamente los dos participantes.
   */
  private canAccess(
    conversation: ConversationCore,
    user: ChatRequestingUser,
  ): boolean {
    if (conversation.type === CHAT_CONVERSATION_TYPE_AREA) {
      if (isMonitorRole(user.roles)) {
        return true;
      }
      if (!conversation.area) return false;
      return (
        user.roles.includes(conversation.area) ||
        user.roles.includes(Role.RECEPCION)
      );
    }
    if (conversation.type === CHAT_CONVERSATION_TYPE_DIRECT) {
      return (
        conversation.directUserAId === user.userId ||
        conversation.directUserBId === user.userId
      );
    }
    return false;
  }

  /**
   * Carga la conversación y verifica que el usuario sea miembro. Lanza 404 si
   * no existe y 403 si no tiene acceso. Toda lectura/escritura del chat pasa
   * por acá.
   */
  async assertConversationAccess(
    conversationId: number,
    user: ChatRequestingUser,
  ): Promise<ConversationCore> {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new HttpException(
        'Conversación no encontrada',
        HttpStatus.NOT_FOUND,
      );
    }
    const conversation = await this.prisma.chatConversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        type: true,
        area: true,
        directUserAId: true,
        directUserBId: true,
      },
    });
    if (!conversation) {
      throw new HttpException(
        'Conversación no encontrada',
        HttpStatus.NOT_FOUND,
      );
    }
    if (!this.canAccess(conversation, user)) {
      throw new HttpException(
        'No tenés acceso a esta conversación',
        HttpStatus.FORBIDDEN,
      );
    }
    return conversation;
  }

  // ---------------------------------------------------------------------
  // Membresías materializadas
  // ---------------------------------------------------------------------

  /**
   * Ids de los usuarios que hoy son miembros de la conversación, según las
   * mismas reglas que `canAccess`, junto con si participan sólo como
   * monitores (admin/superuser). Se recalcula a demanda, así los usuarios
   * nuevos (o los admin creados después) quedan incluidos automáticamente sin
   * necesidad de invitarlos.
   */
  async resolveMembers(
    conversation: ConversationCore,
  ): Promise<{ userId: number; isMonitor: boolean }[]> {
    const participantIds = new Set<number>();
    if (
      conversation.type === CHAT_CONVERSATION_TYPE_AREA &&
      conversation.area
    ) {
      const users = await this.prisma.user.findMany({
        where: {
          roles: {
            some: { name: { in: [conversation.area, Role.RECEPCION] } },
          },
        },
        select: { id: true },
      });
      users.forEach((u) => participantIds.add(u.id));
    } else if (conversation.type === CHAT_CONVERSATION_TYPE_DIRECT) {
      if (conversation.directUserAId) {
        participantIds.add(conversation.directUserAId);
      }
      if (conversation.directUserBId) {
        participantIds.add(conversation.directUserBId);
      }
    }

    const result: { userId: number; isMonitor: boolean }[] = [];
    participantIds.forEach((userId) =>
      result.push({ userId, isMonitor: false }),
    );

    // Los admin/superuser sólo son monitores automáticos de los canales de
    // área (recepción↔departamento). En un DM ajeno no se agregan.
    if (conversation.type === CHAT_CONVERSATION_TYPE_AREA) {
      const monitors = await this.prisma.user.findMany({
        where: {
          roles: { some: { name: { in: [Role.ADMIN, Role.SUPERUSER] } } },
        },
        select: { id: true },
      });
      monitors.forEach((m) => {
        if (!participantIds.has(m.id)) {
          result.push({ userId: m.id, isMonitor: true });
        }
      });
    }
    return result;
  }

  /**
   * Materializa en `ChatConversationMember` la membresía calculada, para
   * poder guardar el marcador de leídos y listar participantes. Las filas de
   * usuarios que ya no son miembros se borran (perdieron el acceso).
   */
  private async syncMembers(conversation: ConversationCore) {
    const members = await this.resolveMembers(conversation);
    const ids = members.map((m) => m.userId);

    await this.prisma.chatConversationMember.deleteMany({
      where: { conversationId: conversation.id, userId: { notIn: ids } },
    });

    for (const member of members) {
      await this.prisma.chatConversationMember.upsert({
        where: {
          conversationId_userId: {
            conversationId: conversation.id,
            userId: member.userId,
          },
        },
        create: {
          conversationId: conversation.id,
          userId: member.userId,
          isMonitor: member.isMonitor,
        },
        update: { isMonitor: member.isMonitor },
      });
    }
    return members;
  }

  /** Participantes de una conversación, con el indicador de monitoreo. */
  async findMembers(conversationId: number, user: ChatRequestingUser) {
    const conversation = await this.assertConversationAccess(
      conversationId,
      user,
    );
    const members = await this.syncMembers(conversation);
    const users = await this.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: USER_SUMMARY_SELECT,
    });
    const monitorById = new Map(members.map((m) => [m.userId, m.isMonitor]));
    return users.map((u) => ({
      ...u,
      isMonitor: monitorById.get(u.id) ?? false,
    }));
  }

  // ---------------------------------------------------------------------
  // Conversaciones
  // ---------------------------------------------------------------------

  /** Crea (idempotente) el canal fijo de cada área operativa. */
  private async ensureAreaConversations() {
    await this.prisma.chatConversation.createMany({
      data: CHAT_AREAS.map((area) => ({
        type: CHAT_CONVERSATION_TYPE_AREA,
        area,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Conversaciones visibles para el usuario: canales de su(s) área(s) (o
   * todos, si es recepción/admin/superuser) + sus mensajes directos. Los
   * admin ven además todos los DMs, para monitoreo.
   */
  async findConversationsForUser(user: ChatRequestingUser) {
    await this.ensureAreaConversations();

    const conversations = await this.prisma.chatConversation.findMany({
      select: {
        id: true,
        type: true,
        area: true,
        directUserAId: true,
        directUserBId: true,
        lastMessageAt: true,
        createdAt: true,
        directUserA: { select: USER_SUMMARY_SELECT },
        directUserB: { select: USER_SUMMARY_SELECT },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
    });

    const visible = conversations.filter((c) => this.canAccess(c, user));

    return Promise.all(
      visible.map(async (conversation) => {
        await this.syncMembers(conversation);
        const [membership, lastMessage] = await Promise.all([
          this.prisma.chatConversationMember.findUnique({
            where: {
              conversationId_userId: {
                conversationId: conversation.id,
                userId: user.userId,
              },
            },
            select: { lastReadAt: true, isMonitor: true },
          }),
          this.prisma.chatMessage.findFirst({
            where: { conversationId: conversation.id },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              body: true,
              createdAt: true,
              sender: { select: USER_SUMMARY_SELECT },
            },
          }),
        ]);

        const unreadCount = await this.prisma.chatMessage.count({
          where: {
            conversationId: conversation.id,
            senderId: { not: user.userId },
            ...(membership?.lastReadAt
              ? { createdAt: { gt: membership.lastReadAt } }
              : {}),
          },
        });

        return this.toConversationDto(conversation, user, {
          unreadCount,
          lastMessage,
          isMonitor: membership?.isMonitor ?? false,
        });
      }),
    );
  }

  /** Título en español según el tipo de conversación. */
  private toConversationDto(
    conversation: {
      id: number;
      type: string;
      area: string | null;
      directUserAId: number | null;
      directUserBId: number | null;
      lastMessageAt: Date | null;
      createdAt: Date;
      directUserA?: {
        id: number;
        username: string;
        firstName: string;
        lastName: string | null;
      } | null;
      directUserB?: {
        id: number;
        username: string;
        firstName: string;
        lastName: string | null;
      } | null;
    },
    user: ChatRequestingUser,
    extra: {
      unreadCount: number;
      lastMessage: unknown;
      isMonitor: boolean;
    },
  ) {
    const isArea = conversation.type === CHAT_CONVERSATION_TYPE_AREA;
    const otherUser = isArea
      ? null
      : conversation.directUserAId === user.userId
        ? (conversation.directUserB ?? null)
        : (conversation.directUserA ?? null);

    const title = isArea
      ? `Recepción ↔ ${chatAreaLabel(conversation.area)}`
      : otherUser
        ? `${otherUser.firstName} ${otherUser.lastName ?? ''}`.trim()
        : [conversation.directUserA, conversation.directUserB]
            .filter(Boolean)
            .map((u) => `${u.firstName} ${u.lastName ?? ''}`.trim())
            .join(' ↔ ');

    return {
      id: conversation.id,
      type: conversation.type,
      area: conversation.area,
      title,
      otherUser,
      participants: isArea
        ? null
        : [conversation.directUserA ?? null, conversation.directUserB ?? null],
      lastMessageAt: conversation.lastMessageAt ?? conversation.createdAt,
      lastMessage: extra.lastMessage,
      unreadCount: extra.unreadCount,
      /** true cuando el usuario está sólo como monitor (admin/superuser). */
      isMonitor: extra.isMonitor,
    };
  }

  /**
   * Devuelve (o crea) el mensaje directo entre el usuario autenticado y otro
   * usuario. `directKey` garantiza una sola conversación por par.
   */
  async getOrCreateDirectConversation(
    otherUserId: number,
    user: ChatRequestingUser,
  ) {
    if (otherUserId === user.userId) {
      throw new HttpException(
        'No podés abrir un chat con vos mismo',
        HttpStatus.BAD_REQUEST,
      );
    }
    const other = await this.prisma.user.findUnique({
      where: { id: otherUserId },
      select: { id: true },
    });
    if (!other) {
      throw new HttpException('Usuario no encontrado', HttpStatus.NOT_FOUND);
    }

    const a = Math.min(user.userId, otherUserId);
    const b = Math.max(user.userId, otherUserId);
    const directKey = `${a}:${b}`;

    const conversation = await this.prisma.chatConversation.upsert({
      where: { directKey },
      create: {
        type: CHAT_CONVERSATION_TYPE_DIRECT,
        directUserAId: a,
        directUserBId: b,
        directKey,
      },
      update: {},
      select: {
        id: true,
        type: true,
        area: true,
        directUserAId: true,
        directUserBId: true,
        lastMessageAt: true,
        createdAt: true,
        directUserA: { select: USER_SUMMARY_SELECT },
        directUserB: { select: USER_SUMMARY_SELECT },
      },
    });

    await this.syncMembers(conversation);

    return this.toConversationDto(conversation, user, {
      unreadCount: 0,
      lastMessage: null,
      isMonitor: false,
    });
  }

  // ---------------------------------------------------------------------
  // Mensajes
  // ---------------------------------------------------------------------

  /**
   * Historial de una conversación, más recientes primero, con paginación
   * opt-in (`?page=&limit=`) igual que el resto de los listados.
   */
  async findMessages(
    conversationId: number,
    user: ChatRequestingUser,
    query?: PaginationQueryDto,
  ) {
    await this.assertConversationAccess(conversationId, user);

    const { enabled, page, limit, skip } = resolvePagination(query);
    const where = { conversationId };
    const select = {
      id: true,
      conversationId: true,
      body: true,
      createdAt: true,
      senderId: true,
      sender: { select: USER_SUMMARY_SELECT },
      orderId: true,
      order: { select: MESSAGE_ORDER_SELECT },
      attachmentData: true,
      ...MESSAGE_ATTACHMENT_SELECT,
    };

    const toDto = (message: any) => {
      const { attachmentData, ...rest } = message;
      return {
        ...rest,
        attachment: toAttachmentDto({ attachmentData, ...rest }),
      };
    };

    let messages: any[];
    if (!enabled) {
      messages = await this.prisma.chatMessage.findMany({
        where,
        select,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return messages.map(toDto);
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.chatMessage.findMany({
        where,
        select,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.chatMessage.count({ where }),
    ]);
    messages = data;

    return buildPaginatedResult(messages.map(toDto), total, page, limit);
  }

  /**
   * Persiste el mensaje y lo emite en vivo por WebSocket a la room individual
   * de cada miembro (mismo patrón dual persistir+emitir de las
   * notificaciones). Los destinatarios se calculan en el servidor, así que un
   * admin recibe los mensajes de cualquier conversación sin estar invitado.
   */
  async sendMessage(
    conversationId: number,
    body: string | undefined,
    user: ChatRequestingUser,
    orderId?: number,
    attachment?: ChatAttachmentDto,
  ) {
    if (!body && !attachment) {
      throw new HttpException(
        'El mensaje no puede estar vacío',
        HttpStatus.BAD_REQUEST,
      );
    }

    const conversation = await this.assertConversationAccess(
      conversationId,
      user,
    );

    if (orderId != null) {
      // Reusa la misma verificación de visibilidad que `GET /orders/:id`:
      // si quien manda el mensaje no puede ver ese pedido, no puede
      // adjuntarlo. `findOne` tira 403/404 por sí solo si corresponde.
      await this.orderService.findOne(orderId, {
        userId: user.userId,
        roles: user.roles,
      });
    }

    let attachmentBuffer: Buffer | undefined;
    if (attachment) {
      attachmentBuffer = await this.assertChatAttachmentValid(attachment);
    }

    const message = await this.prisma.chatMessage.create({
      data: {
        conversationId,
        senderId: user.userId,
        body: body ?? null,
        orderId,
        ...(attachment && {
          attachmentData: attachment.data,
          attachmentFilename: attachment.filename,
          attachmentMimeType: attachment.mimeType,
          attachmentSize: attachmentBuffer!.length,
        }),
      },
      select: {
        id: true,
        conversationId: true,
        body: true,
        createdAt: true,
        senderId: true,
        sender: { select: USER_SUMMARY_SELECT },
        orderId: true,
        order: { select: MESSAGE_ORDER_SELECT },
        attachmentData: true,
        ...MESSAGE_ATTACHMENT_SELECT,
      },
    });

    await this.prisma.chatConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt },
    });

    const members = await this.syncMembers(conversation);

    // Quien escribe ya leyó su propio mensaje.
    await this.prisma.chatConversationMember.updateMany({
      where: { conversationId, userId: user.userId },
      data: { lastReadAt: message.createdAt },
    });

    const { attachmentData, ...messageRest } = message;
    const attachmentDto = toAttachmentDto({ attachmentData, ...messageRest });

    this.notificationsGateway.emitChatMessage(
      members.map((m) => m.userId),
      {
        id: message.id,
        conversationId: message.conversationId,
        body: message.body,
        createdAt: message.createdAt,
        senderId: message.senderId,
        senderUsername: message.sender.username,
        senderName:
          `${message.sender.firstName} ${message.sender.lastName ?? ''}`.trim(),
        orderId: message.orderId,
        order: message.order,
        attachment: attachmentDto,
      },
    );

    return { ...messageRest, attachment: attachmentDto };
  }

  /** Valida tamaño y tipo real (magic bytes) de un adjunto de chat, igual
   * que `OrderService.assertAuthorizationFileSize` pero con la lista de
   * mime types ampliada a audio (fotos, documentos y audios). */
  private async assertChatAttachmentValid(
    attachment: ChatAttachmentDto,
  ): Promise<Buffer> {
    return assertBase64FileValid(attachment, {
      maxBytes: MAX_CHAT_ATTACHMENT_BYTES,
      allowedMimeTypes: CHAT_ATTACHMENT_MIME_TYPES,
      sizeErrorMessage: 'El archivo no puede superar 5MB',
      typeErrorMessage:
        'El contenido del archivo no coincide con un tipo permitido (imagen, PDF o audio)',
    });
  }

  /** Marca como leída la conversación hasta el instante actual. */
  async markConversationAsRead(
    conversationId: number,
    user: ChatRequestingUser,
  ) {
    const conversation = await this.assertConversationAccess(
      conversationId,
      user,
    );
    await this.syncMembers(conversation);
    await this.prisma.chatConversationMember.updateMany({
      where: { conversationId, userId: user.userId },
      data: { lastReadAt: new Date() },
    });
    return { message: 'Conversación marcada como leída' };
  }

  /** Total de mensajes no leídos del usuario, para el badge global del menú. */
  async unreadCount(
    user: ChatRequestingUser,
  ): Promise<{ unreadCount: number }> {
    const conversations = await this.findConversationsForUser(user);
    return {
      unreadCount: conversations.reduce((acc, c) => acc + c.unreadCount, 0),
    };
  }

  /** Usuarios con los que se puede abrir un mensaje directo. */
  async findChatUsers(user: ChatRequestingUser) {
    const users = await this.prisma.user.findMany({
      where: { id: { not: user.userId } },
      select: { ...USER_SUMMARY_SELECT, roles: { select: { name: true } } },
      orderBy: [{ firstName: 'asc' }, { username: 'asc' }],
    });
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      firstName: u.firstName,
      lastName: u.lastName,
      roles: u.roles.map((r) => r.name),
    }));
  }
}
