import { Prisma } from '@prisma/client';
import { HttpException, HttpStatus } from '@nestjs/common';
import { UserService, USER_PREFERENCES_SELECT } from './user.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  JSON_PREFERENCE_KEYS,
  MAX_JSON_PREFERENCE_BYTES,
} from './json-preferences';

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

    it('guarda los frecuentes propios y null vuelve al orden por defecto', async () => {
      prisma.user.update.mockResolvedValue({});
      await service.updatePreferences(1, { frequentProductIds: [3, 1] });
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        frequentProductIds: [3, 1],
      });
      await service.updatePreferences(1, { frequentProductIds: null });
      expect(prisma.user.update.mock.calls[1][0].data).toEqual({
        frequentProductIds: Prisma.DbNull,
      });
    });

    it('guarda la barra lateral y los colores tal cual llegan', async () => {
      const navPreferences = {
        favorites: ['/dashboard/orders'],
        order: ['/dashboard/inicio', '/dashboard/admin'],
        hidden: ['/dashboard/historial'],
        expanded: true,
      };
      const mockupColors = { favorites: ['#ff0000'], custom: ['#00aa11'] };
      prisma.user.update.mockResolvedValue({ navPreferences, mockupColors });

      const result = await service.updatePreferences(1, {
        navPreferences,
        mockupColors,
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { navPreferences, mockupColors },
        select: USER_PREFERENCES_SELECT,
      });
      expect(result).toEqual({ navPreferences, mockupColors });
    });

    it('null en la barra lateral o los colores se guarda como NULL de base (DbNull)', async () => {
      prisma.user.update.mockResolvedValue({});
      await service.updatePreferences(1, { navPreferences: null });
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        navPreferences: Prisma.DbNull,
      });
      await service.updatePreferences(1, { mockupColors: null });
      expect(prisma.user.update.mock.calls[1][0].data).toEqual({
        mockupColors: Prisma.DbNull,
      });
      await service.updatePreferences(1, {
        navPreferences: null,
        mockupColors: null,
        frequentProductIds: null,
      });
      expect(prisma.user.update.mock.calls[2][0].data).toEqual({
        navPreferences: Prisma.DbNull,
        mockupColors: Prisma.DbNull,
        frequentProductIds: Prisma.DbNull,
      });
    });

    describe('guardia de preferencias Json (R4)', () => {
      const nav = (overrides: Record<string, unknown> = {}) => ({
        favorites: [],
        order: [],
        hidden: [],
        expanded: false,
        ...overrides,
      });
      const longUrls = (n: number) =>
        Array.from(
          { length: n },
          (_, i) =>
            `/dashboard/${String(i).padStart(3, '0')}-${'a'.repeat(80)}`,
        );

      const statusOf = async (dto: Record<string, unknown>) => {
        try {
          await service.updatePreferences(1, dto);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          return (error as HttpException).getStatus();
        }
        throw new Error('Se esperaba una HttpException');
      };

      it('rechaza con 413 una preferencia Json de más de 8KB aunque tenga forma válida', async () => {
        const navPreferences = nav({ order: longUrls(100) });
        expect(
          Buffer.byteLength(JSON.stringify(navPreferences)),
        ).toBeGreaterThan(MAX_JSON_PREFERENCE_BYTES);
        expect(await statusOf({ navPreferences })).toBe(
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
        expect(prisma.user.update).not.toHaveBeenCalled();
      });

      it('acepta una preferencia Json de hasta 8KB', async () => {
        prisma.user.update.mockResolvedValue({});
        const navPreferences = nav({ order: longUrls(80) });
        expect(
          Buffer.byteLength(JSON.stringify(navPreferences)),
        ).toBeLessThanOrEqual(MAX_JSON_PREFERENCE_BYTES);
        await service.updatePreferences(1, { navPreferences });
        expect(prisma.user.update).toHaveBeenCalled();
      });

      it.each<[string, Record<string, unknown>]>([
        [
          '__proto__ propio',
          {
            navPreferences: JSON.parse(
              '{"favorites":[],"order":[],"hidden":[],"expanded":true,"__proto__":{"x":1}}',
            ),
          },
        ],
        [
          'constructor',
          { mockupColors: { favorites: [], custom: [], constructor: 1 } },
        ],
        ['prototype', { navPreferences: nav({ prototype: {} }) }],
        [
          'un NUL en una url',
          { navPreferences: nav({ favorites: ['/dashboard/\u0000'] }) },
        ],
        [
          'forma inválida (sin el pipe)',
          { navPreferences: nav({ order: {} }) },
        ],
        [
          'colores inválidos (sin el pipe)',
          { mockupColors: { favorites: ['red'], custom: [] } },
        ],
        [
          'frecuentes inválidos (sin el pipe)',
          { frequentProductIds: [0, 'x'] },
        ],
      ])('rechaza con 400: %s', async (_name, dto) => {
        expect(await statusOf(dto)).toBe(HttpStatus.BAD_REQUEST);
        expect(prisma.user.update).not.toHaveBeenCalled();
      });

      it('cubre todas las columnas Json de preferencias', () => {
        expect([...JSON_PREFERENCE_KEYS].sort()).toEqual([
          'frequentProductIds',
          'mockupColors',
          'navPreferences',
        ]);
        for (const key of JSON_PREFERENCE_KEYS) {
          expect(USER_PREFERENCES_SELECT).toHaveProperty(key, true);
        }
      });
    });

    it('lee y devuelve las preferencias nuevas en la misma selección', () => {
      expect(USER_PREFERENCES_SELECT).toMatchObject({
        navPreferences: true,
        mockupColors: true,
      });
    });
  });
});
