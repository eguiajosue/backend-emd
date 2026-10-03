import { formatOrderCode, parseOrderCode } from './order-code';

describe('formatOrderCode', () => {
  it('rellena a 4 dígitos con el prefijo EMD-P', () => {
    expect(formatOrderCode(42)).toBe('EMD-P0042');
    expect(formatOrderCode(1)).toBe('EMD-P0001');
  });

  it('pasado el 9999 crece sin cortar', () => {
    expect(formatOrderCode(12345)).toBe('EMD-P12345');
  });
});

describe('parseOrderCode', () => {
  it('entiende el código escrito de varias formas', () => {
    for (const text of [
      'EMD-P0042',
      'emd-p42',
      'EMD_P0042',
      'P42',
      '#42',
      '42',
    ]) {
      expect(parseOrderCode(text)).toBe(42);
    }
  });

  it('devuelve null si no es un código', () => {
    expect(parseOrderCode('playeras')).toBeNull();
    expect(parseOrderCode('0')).toBeNull();
    expect(parseOrderCode('99999999999')).toBeNull();
  });
});
