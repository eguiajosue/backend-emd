/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { UserService } from './user.service';

function makePrisma() {
  return {
    user: {
      update: jest.fn(async ({ data }: any) => ({
        avatarSeed: data.avatarSeed,
      })),
    },
  } as any;
}

describe('UserService.rerollAvatar', () => {
  it('guarda y devuelve una semilla hex de 12 caracteres', async () => {
    const prisma = makePrisma();
    const result = await new UserService(prisma).rerollAvatar(7);

    expect(result.avatarSeed).toMatch(/^[0-9a-f]{12}$/);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: { avatarSeed: result.avatarSeed },
      }),
    );
  });

  it('dos sorteos dan semillas distintas', async () => {
    const service = new UserService(makePrisma());
    const a = await service.rerollAvatar(7);
    const b = await service.rerollAvatar(7);

    expect(a.avatarSeed).not.toBe(b.avatarSeed);
  });
});
