import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderMockupDto } from './create-order-mockup.dto';

/** Mismo pipe que main.ts: whitelist + forbidNonWhitelisted. */
const errorsFor = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(CreateOrderMockupDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
};

const valid = {
  garment: 'cap',
  imageDataUrl: 'data:image/png;base64,AAAA',
  config: { garment: 'cap', colors: { body: '#000' }, layers: [] },
};

describe('CreateOrderMockupDto', () => {
  it('acepta el payload del frontend, con campos extra dentro de config', async () => {
    expect(
      await errorsFor({
        ...valid,
        config: { ...valid.config, futureField: true },
      }),
    ).toEqual([]);
  });

  it('rechaza una prenda fuera de tshirt/cap', async () => {
    expect(await errorsFor({ ...valid, garment: 'hoodie' })).toEqual([
      'garment',
    ]);
  });

  it('exige imageDataUrl y un config objeto (no array)', async () => {
    expect(
      (
        await errorsFor({ garment: 'cap', imageDataUrl: '', config: [] })
      ).sort(),
    ).toEqual(['config', 'imageDataUrl']);
  });
});
