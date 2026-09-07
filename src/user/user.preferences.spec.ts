import { HttpException, HttpStatus } from '@nestjs/common';
import { UserService, USER_PREFERENCES_SELECT } from './user.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UserService preferences', () => {
  let service: UserService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new UserService(prisma as unknown as PrismaService);
  });

  describe('getPreferences', () => {
    it('devuelve las preferencias del usuario', async () => {
      prisma.user.findUnique.mockResolvedValue({
        themePreference: 'dark',
        accentColor: 'rose',
        languagePreference: 'es',
      });

      const result = await service.getPreferences(1);

      expect(result).toEqual({
        themePreference: 'dark',
        accentColor: 'rose',
        languagePreference: 'es',
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: USER_PREFERENCES_SELECT,
      });
    });

    it('lanza 404 si el usuario no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getPreferences(999)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });
  });

  describe('updatePreferences', () => {
    it('actualiza solo los campos de preferencias del usuario autenticado', async () => {
      prisma.user.update.mockResolvedValue({
        themePreference: 'light',
        accentColor: '#3366ff',
        languagePreference: 'en',
      });

      const result = await service.updatePreferences(1, {
        themePreference: 'light',
        accentColor: '#3366ff',
        languagePreference: 'en',
      });

      expect(result).toEqual({
        themePreference: 'light',
        accentColor: '#3366ff',
        languagePreference: 'en',
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          themePreference: 'light',
          accentColor: '#3366ff',
          languagePreference: 'en',
        },
        select: USER_PREFERENCES_SELECT,
      });
    });

    it('lanza 404 si el usuario no existe (P2025)', async () => {
      prisma.user.update.mockRejectedValue({ code: 'P2025' });

      await expect(
        service.updatePreferences(999, { themePreference: 'dark' }),
      ).rejects.toBeInstanceOf(HttpException);
    });
  });
});
