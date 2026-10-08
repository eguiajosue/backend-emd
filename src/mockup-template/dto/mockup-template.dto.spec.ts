import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateMockupTemplateDto,
  RenameMockupTemplateDto,
} from './mockup-template.dto';

/** Mismo pipe que main.ts: whitelist + forbidNonWhitelisted. */
const errorsFor = async (
  cls: typeof CreateMockupTemplateDto | typeof RenameMockupTemplateDto,
  body: Record<string, unknown>,
) => {
  const dto = plainToInstance(cls, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property).sort();
};

const valid = {
  name: 'Gorra negra',
  garment: 'cap',
  config: { garment: 'cap', colors: { body: '#000' }, layers: [] },
  thumbnailDataUrl: 'data:image/png;base64,AAAA',
};

describe('CreateMockupTemplateDto', () => {
  it('acepta el payload del frontend, con campos extra dentro de config', async () => {
    expect(
      await errorsFor(CreateMockupTemplateDto, {
        ...valid,
        config: { ...valid.config, futureField: true },
      }),
    ).toEqual([]);
  });

  it.each([
    'tshirt',
    'cap',
    'hoodie',
    'dress-shirt',
    'termo',
    'taza',
    'mousepad',
    'car',
    'minivan',
    'pickup',
    'trailer',
    'bicycle',
  ])('acepta la prenda %s', async (garment) => {
    expect(
      await errorsFor(CreateMockupTemplateDto, { ...valid, garment }),
    ).toEqual([]);
  });

  it('rechaza prenda desconocida, nombre vacío o largo, config array y sin miniatura', async () => {
    expect(
      await errorsFor(CreateMockupTemplateDto, {
        name: '   ',
        garment: 'pants',
        config: [],
        thumbnailDataUrl: '',
      }),
    ).toEqual(['config', 'garment', 'name', 'thumbnailDataUrl']);
    expect(
      await errorsFor(CreateMockupTemplateDto, {
        ...valid,
        name: 'x'.repeat(81),
      }),
    ).toEqual(['name']);
  });

  it('rechaza campos de más', async () => {
    expect(
      await errorsFor(CreateMockupTemplateDto, { ...valid, imageData: 'x' }),
    ).toEqual(['imageData']);
  });
});

describe('RenameMockupTemplateDto', () => {
  it('sólo acepta name', async () => {
    expect(await errorsFor(RenameMockupTemplateDto, { name: 'Otra' })).toEqual(
      [],
    );
    expect(
      await errorsFor(RenameMockupTemplateDto, {
        name: 'Otra',
        garment: 'cap',
      }),
    ).toEqual(['garment']);
    expect(await errorsFor(RenameMockupTemplateDto, { name: '' })).toEqual([
      'name',
    ]);
  });
});
