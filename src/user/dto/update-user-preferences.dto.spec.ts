import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserPreferencesDto } from './update-user-preferences.dto';
import {
  MAX_MOCKUP_COLORS,
  MAX_NAV_LIST_ITEMS,
  MAX_NAV_ORDER_ITEMS,
} from './user-preferences-shapes';

/** Mismo pipe que main.ts: whitelist + forbidNonWhitelisted. */
const errorsFor = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(UpdateUserPreferencesDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
};

const nav = (overrides: Record<string, unknown> = {}) => ({
  favorites: ['/dashboard/orders', '/dashboard/mockups'],
  order: ['/dashboard/inicio', '/dashboard/admin', '/dashboard/chat'],
  hidden: ['/dashboard/historial'],
  expanded: true,
  ...overrides,
});

const colors = (overrides: Record<string, unknown> = {}) => ({
  favorites: ['#ff0000', '#00FF00'],
  custom: ['#123abc'],
  ...overrides,
});

const urls = (n: number) =>
  Array.from({ length: n }, (_, i) => `/dashboard/item-${i}`);

describe('UpdateUserPreferencesDto', () => {
  describe('navPreferences', () => {
    it('acepta la forma completa, listas vacías y null', async () => {
      expect(await errorsFor({ navPreferences: nav() })).toEqual([]);
      expect(
        await errorsFor({
          navPreferences: nav({
            favorites: [],
            order: [],
            hidden: [],
            expanded: false,
          }),
        }),
      ).toEqual([]);
      expect(await errorsFor({ navPreferences: null })).toEqual([]);
    });

    it('acepta los topes justos (50 favoritos/ocultos, 100 en order, url de 200)', async () => {
      const longUrl = '/dashboard/' + 'a'.repeat(200 - '/dashboard/'.length);
      expect(
        await errorsFor({
          navPreferences: nav({
            favorites: urls(MAX_NAV_LIST_ITEMS),
            hidden: [longUrl],
            order: urls(MAX_NAV_ORDER_ITEMS),
          }),
        }),
      ).toEqual([]);
    });

    it.each<[string, unknown]>([
      ['un array', []],
      ['un string', '/dashboard'],
      ['sin expanded', { favorites: [], order: [], hidden: [] }],
      ['con una clave de más', nav({ extra: true })],
      ['expanded no booleano', nav({ expanded: 'true' })],
      ['favorites no array', nav({ favorites: '/dashboard/orders' })],
      ['más de 50 favoritos', nav({ favorites: urls(MAX_NAV_LIST_ITEMS + 1) })],
      ['más de 50 ocultos', nav({ hidden: urls(MAX_NAV_LIST_ITEMS + 1) })],
      ['una url fuera de /dashboard', nav({ favorites: ['/login'] })],
      ['una url absoluta', nav({ hidden: ['https://x.com/dashboard'] })],
      ['una url no string', nav({ favorites: [42] })],
      [
        'una url de más de 200 caracteres',
        nav({ favorites: ['/dashboard/' + 'a'.repeat(200)] }),
      ],
      ['una url con NUL', nav({ favorites: ['/dashboard/\u0000'] })],
      [
        'order por grupo (formato anterior)',
        nav({ order: { Operación: ['/dashboard/inicio'] } }),
      ],
      ['order con una url inválida', nav({ order: ['/otra-cosa'] })],
      ['order con algo que no es string', nav({ order: [['/dashboard']] })],
      [
        'order con más de 100 urls',
        nav({ order: urls(MAX_NAV_ORDER_ITEMS + 1) }),
      ],
    ])('rechaza %s', async (_name, value) => {
      expect(await errorsFor({ navPreferences: value })).toEqual([
        'navPreferences',
      ]);
    });
  });

  describe('mockupColors', () => {
    it('acepta favoritos y propios #rrggbb (mayúsculas o minúsculas), vacíos y null', async () => {
      expect(await errorsFor({ mockupColors: colors() })).toEqual([]);
      expect(
        await errorsFor({ mockupColors: { favorites: [], custom: [] } }),
      ).toEqual([]);
      expect(await errorsFor({ mockupColors: null })).toEqual([]);
    });

    it('acepta 48 colores por lista', async () => {
      const list = Array.from({ length: MAX_MOCKUP_COLORS }, () => '#abcdef');
      expect(
        await errorsFor({ mockupColors: { favorites: list, custom: list } }),
      ).toEqual([]);
    });

    it.each<[string, unknown]>([
      ['un array', []],
      ['sin custom', { favorites: [] }],
      ['con una clave de más', colors({ names: {} })],
      ['un hex corto', colors({ favorites: ['#fff'] })],
      ['un hex sin #', colors({ custom: ['ff0000'] })],
      ['un hex con alfa', colors({ custom: ['#ff000080'] })],
      ['un nombre de color', colors({ favorites: ['red'] })],
      ['un objeto en la lista', colors({ custom: [{ hex: '#ff0000' }] })],
      [
        'más de 48 favoritos',
        colors({
          favorites: Array.from(
            { length: MAX_MOCKUP_COLORS + 1 },
            () => '#000000',
          ),
        }),
      ],
      [
        'más de 48 propios',
        colors({
          custom: Array.from(
            { length: MAX_MOCKUP_COLORS + 1 },
            () => '#000000',
          ),
        }),
      ],
    ])('rechaza %s', async (_name, value) => {
      expect(await errorsFor({ mockupColors: value })).toEqual([
        'mockupColors',
      ]);
    });
  });

  it('sigue aceptando las preferencias existentes junto a las nuevas', async () => {
    expect(
      await errorsFor({
        themePreference: 'dark',
        frequentProductIds: [1, 2],
        navPreferences: nav(),
        mockupColors: colors(),
      }),
    ).toEqual([]);
  });
});
