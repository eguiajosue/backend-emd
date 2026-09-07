import { ChatService } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { OrderService } from 'src/order/order.service';

/**
 * Conversaciones de prueba: el canal Recepción↔Taller, el canal
 * Recepción↔Diseño y un DM entre los usuarios 10 y 11.
 */
const CONVERSATIONS = {
  1: {
    id: 1,
    type: 'area',
    area: 'taller',
    directUserAId: null,
    directUserBId: null,
  },
  2: {
    id: 2,
    type: 'area',
    area: 'diseno',
    directUserAId: null,
    directUserBId: null,
  },
  3: {
    id: 3,
    type: 'direct',
    area: null,
    directUserAId: 10,
    directUserBId: 11,
  },
};

describe('ChatService - autorización', () => {
  let chatService: ChatService;
  let prisma: any;
  let gateway: { emitChatMessage: jest.Mock };
  let orderService: { findOne: jest.Mock };

  beforeEach(() => {
    prisma = {
      chatConversation: {
        findUnique: jest.fn(({ where }) => CONVERSATIONS[where.id] ?? null),
        findMany: jest.fn().mockResolvedValue(
          Object.values(CONVERSATIONS).map((c) => ({
            ...c,
            lastMessageAt: null,
            createdAt: new Date('2026-01-01'),
            directUserA: null,
            directUserB: null,
          })),
        ),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      chatConversationMember: {
        deleteMany: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      chatMessage: {
        create: jest.fn().mockResolvedValue({
          id: 100,
          conversationId: 1,
          body: 'hola',
          createdAt: new Date('2026-01-02'),
          senderId: 5,
          sender: {
            id: 5,
            username: 'recep',
            firstName: 'Ana',
            lastName: 'Gómez',
          },
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: {
        // El primer findMany de resolveMembers busca admin/superuser.
        findMany: jest.fn(({ where }) => {
          const names = where?.roles?.some?.name?.in ?? [];
          if (names.includes('admin')) {
            return Promise.resolve([{ id: 99 }]);
          }
          return Promise.resolve([{ id: 5 }, { id: 7 }]);
        }),
        findUnique: jest.fn().mockResolvedValue({ id: 11 }),
      },
    };
    gateway = { emitChatMessage: jest.fn() };
    orderService = { findOne: jest.fn().mockResolvedValue({ id: 1 }) };

    chatService = new ChatService(
      prisma as unknown as PrismaService,
      gateway as unknown as NotificationsGateway,
      orderService as unknown as OrderService,
    );
  });

  it('un usuario operativo NO puede leer el canal de otra área', async () => {
    await expect(
      chatService.assertConversationAccess(2, { userId: 7, roles: ['taller'] }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('un usuario operativo SÍ puede leer el canal de su propia área', async () => {
    await expect(
      chatService.assertConversationAccess(1, { userId: 7, roles: ['taller'] }),
    ).resolves.toMatchObject({ id: 1, area: 'taller' });
  });

  it('recepción participa de todos los canales de área', async () => {
    await expect(
      chatService.assertConversationAccess(2, {
        userId: 5,
        roles: ['recepcion'],
      }),
    ).resolves.toMatchObject({ id: 2 });
  });

  it('recepción NO accede a un DM ajeno', async () => {
    await expect(
      chatService.assertConversationAccess(3, {
        userId: 5,
        roles: ['recepcion'],
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('un no miembro es rechazado de un DM ajeno', async () => {
    await expect(
      chatService.assertConversationAccess(3, { userId: 7, roles: ['taller'] }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('un participante SÍ accede a su DM', async () => {
    await expect(
      chatService.assertConversationAccess(3, { userId: 11, roles: ['dtf'] }),
    ).resolves.toMatchObject({ id: 3 });
  });

  it('el admin es miembro de TODO canal de área, pero NO de un DM ajeno', async () => {
    const admin = { userId: 99, roles: ['admin'] };
    await expect(
      chatService.assertConversationAccess(1, admin),
    ).resolves.toBeTruthy();
    await expect(
      chatService.assertConversationAccess(2, admin),
    ).resolves.toBeTruthy();
    await expect(
      chatService.assertConversationAccess(3, admin),
    ).rejects.toMatchObject({ status: 403 });

    const conversations = await chatService.findConversationsForUser(admin);
    expect(conversations.map((c) => c.id).sort()).toEqual([1, 2]);
  });

  it('el admin SÍ accede al DM en el que él mismo es participante', async () => {
    await expect(
      chatService.assertConversationAccess(3, { userId: 10, roles: ['admin'] }),
    ).resolves.toBeTruthy();
  });

  it('superuser tiene la misma visibilidad total que admin sobre los canales de área, pero no sobre DMs ajenos', async () => {
    await expect(
      chatService.assertConversationAccess(1, {
        userId: 98,
        roles: ['superuser'],
      }),
    ).resolves.toBeTruthy();
    await expect(
      chatService.assertConversationAccess(3, {
        userId: 98,
        roles: ['superuser'],
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('un usuario de taller sólo ve su canal en la lista de conversaciones', async () => {
    const conversations = await chatService.findConversationsForUser({
      userId: 7,
      roles: ['taller'],
    });
    expect(conversations.map((c) => c.id)).toEqual([1]);
  });

  it('resolveMembers incluye a los admin como monitores en un canal de área', async () => {
    const members = await chatService.resolveMembers(CONVERSATIONS[1] as any);
    expect(members).toEqual(
      expect.arrayContaining([
        { userId: 5, isMonitor: false },
        { userId: 7, isMonitor: false },
        { userId: 99, isMonitor: true },
      ]),
    );
  });

  it('resolveMembers de un DM NO incluye a los admin', async () => {
    const members = await chatService.resolveMembers(CONVERSATIONS[3] as any);
    expect(members).toEqual([
      { userId: 10, isMonitor: false },
      { userId: 11, isMonitor: false },
    ]);
  });

  it('enviar un mensaje a una conversación ajena no persiste ni emite nada', async () => {
    await expect(
      chatService.sendMessage(3, 'hola', { userId: 7, roles: ['taller'] }),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
    expect(gateway.emitChatMessage).not.toHaveBeenCalled();
  });

  it('enviar un mensaje persiste y emite a todos los miembros (incluido el admin)', async () => {
    await chatService.sendMessage(1, 'hola', {
      userId: 5,
      roles: ['recepcion'],
    });
    expect(prisma.chatMessage.create).toHaveBeenCalled();
    expect(gateway.emitChatMessage).toHaveBeenCalledWith(
      expect.arrayContaining([5, 7, 99]),
      expect.objectContaining({ body: 'hola', conversationId: 1 }),
    );
  });

  it('leer el historial de una conversación ajena es rechazado', async () => {
    await expect(
      chatService.findMessages(2, { userId: 7, roles: ['taller'] }),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.chatMessage.findMany).not.toHaveBeenCalled();
  });

  it('una conversación inexistente devuelve 404, no 403', async () => {
    await expect(
      chatService.assertConversationAccess(999, {
        userId: 99,
        roles: ['admin'],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
