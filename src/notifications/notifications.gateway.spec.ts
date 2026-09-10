import { NotificationsGateway } from './notifications.gateway';

function makeConfigService(secret = 'test-secret') {
  return { get: jest.fn().mockReturnValue(secret) } as any;
}

function makeServer() {
  const rooms = new Map<string, Set<string>>();
  const to = jest.fn().mockReturnThis();
  const emit = jest.fn();
  return {
    to,
    emit,
    sockets: { adapter: { rooms } },
    __rooms: rooms,
  } as any;
}

describe('NotificationsGateway - presencia y listeners de chat', () => {
  let gateway: NotificationsGateway;
  let prisma: any;
  let server: ReturnType<typeof makeServer>;

  beforeEach(() => {
    prisma = {
      user: { update: jest.fn().mockResolvedValue({}) },
      chatConversationMember: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    gateway = new NotificationsGateway(makeConfigService(), prisma);
    server = makeServer();
    gateway.server = server;
  });

  describe('isUserOnline', () => {
    it('true si la room del usuario tiene al menos un socket', () => {
      server.__rooms.set('user:5', new Set(['socket-a']));
      expect(gateway.isUserOnline(5)).toBe(true);
    });

    it('false si la room no existe', () => {
      expect(gateway.isUserOnline(5)).toBe(false);
    });
  });

  describe('handleDisconnect', () => {
    it('escribe lastSeenAt y emite presenceChanged cuando era el último socket', async () => {
      const client: any = { id: 's1', data: { userId: 7 } };
      // La room ya no tiene al cliente (socket.io la saca antes de disparar 'disconnect').
      await gateway.handleDisconnect(client);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { lastSeenAt: expect.any(Date) },
      });
      expect(server.emit).toHaveBeenCalledWith(
        'presenceChanged',
        expect.objectContaining({ userId: 7, online: false }),
      );
    });

    it('NO escribe lastSeenAt si el usuario todavía tiene otro socket vivo', async () => {
      server.__rooms.set('user:7', new Set(['otro-socket']));
      const client: any = { id: 's1', data: { userId: 7 } };

      await gateway.handleDisconnect(client);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(server.emit).not.toHaveBeenCalled();
    });

    it('no hace nada si el cliente nunca completó el handshake (sin userId)', async () => {
      const client: any = { id: 's1', data: {} };
      await gateway.handleDisconnect(client);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('handleChatDelivered', () => {
    it('actualiza deliveredAt y reemite a los demás miembros cuando el emisor es miembro', async () => {
      prisma.chatConversationMember.findUnique.mockResolvedValue({ id: 1 });
      prisma.chatConversationMember.findMany.mockResolvedValue([
        { userId: 20 },
        { userId: 21 },
      ]);
      const client: any = { data: { userId: 10 } };

      await gateway.handleChatDelivered(client, { conversationId: 3 });

      expect(prisma.chatConversationMember.updateMany).toHaveBeenCalledWith({
        where: { conversationId: 3, userId: 10 },
        data: { deliveredAt: expect.any(Date) },
      });
      expect(server.to).toHaveBeenCalledWith('user:20');
      expect(server.to).toHaveBeenCalledWith('user:21');
      expect(server.emit).toHaveBeenCalledWith(
        'chatDelivered',
        expect.objectContaining({ conversationId: 3, userId: 10 }),
      );
    });

    it('ignora el evento si el emisor NO es miembro de la conversación', async () => {
      prisma.chatConversationMember.findUnique.mockResolvedValue(null);
      const client: any = { data: { userId: 999 } };

      await gateway.handleChatDelivered(client, { conversationId: 3 });

      expect(prisma.chatConversationMember.updateMany).not.toHaveBeenCalled();
      expect(server.emit).not.toHaveBeenCalled();
    });
  });

  describe('handleChatTyping / handleChatStopTyping', () => {
    it('reemite chatTyping sólo a los demás miembros, validando membresía primero', async () => {
      prisma.chatConversationMember.findUnique.mockResolvedValue({ id: 1 });
      prisma.chatConversationMember.findMany.mockResolvedValue([
        { userId: 20 },
      ]);
      const client: any = { data: { userId: 10 } };

      await gateway.handleChatTyping(client, { conversationId: 3 });

      expect(server.to).toHaveBeenCalledWith('user:20');
      expect(server.emit).toHaveBeenCalledWith(
        'chatTyping',
        expect.objectContaining({ conversationId: 3, userId: 10 }),
      );
    });

    it('ignora chatStopTyping de alguien que no es miembro', async () => {
      prisma.chatConversationMember.findUnique.mockResolvedValue(null);
      const client: any = { data: { userId: 999 } };

      await gateway.handleChatStopTyping(client, { conversationId: 3 });

      expect(server.emit).not.toHaveBeenCalled();
    });
  });
});
