/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { ChatService } from './chat.service';

describe('ChatService.findChatUsers - avatar', () => {
  it('pide y devuelve avatarSeed de cada usuario', async () => {
    const prisma: any = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 11,
            username: 'ana',
            firstName: 'Ana',
            lastName: null,
            avatarSeed: 'abc123',
            roles: [],
            areas: [],
            lastSeenAt: null,
          },
        ]),
      },
    };
    const gateway: any = { isUserOnline: jest.fn().mockReturnValue(false) };
    const service = new ChatService(prisma, gateway, {} as any, {} as any);

    const result = await service.findChatUsers({ userId: 1, roles: [] } as any);

    expect(prisma.user.findMany.mock.calls[0][0].select.avatarSeed).toBe(true);
    expect(result[0]).toHaveProperty('avatarSeed', 'abc123');
  });
});
