import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMockupLogoDto, RenameMockupLogoDto } from './mockup-logo.dto';

/** Mismo pipe que main.ts: whitelist + forbidNonWhitelisted. */
const errorsFor = async (
  cls: typeof CreateMockupLogoDto | typeof RenameMockupLogoDto,
  body: Record<string, unknown>,
) => {
  const dto = plainToInstance(cls, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property).sort();
};

describe('CreateMockupLogoDto', () => {
  it('acepta nombre e imagen', async () => {
    expect(
      await errorsFor(CreateMockupLogoDto, {
        name: 'Logo',
        imageDataUrl: 'data:image/png;base64,AAAA',
      }),
    ).toEqual([]);
  });

  it('rechaza nombre vacío o largo, imagen vacía y campos de más', async () => {
    expect(
      await errorsFor(CreateMockupLogoDto, { name: ' ', imageDataUrl: '' }),
    ).toEqual(['imageDataUrl', 'name']);
    expect(
      await errorsFor(CreateMockupLogoDto, {
        name: 'x'.repeat(81),
        imageDataUrl: 'data:image/png;base64,AAAA',
        useCount: 99,
      }),
    ).toEqual(['name', 'useCount']);
  });
});

describe('RenameMockupLogoDto', () => {
  it('sólo acepta name', async () => {
    expect(await errorsFor(RenameMockupLogoDto, { name: 'Otro' })).toEqual([]);
    expect(
      await errorsFor(RenameMockupLogoDto, { name: 'Otro', useCount: 1 }),
    ).toEqual(['useCount']);
  });
});
