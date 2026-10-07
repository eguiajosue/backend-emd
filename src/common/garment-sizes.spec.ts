import { HttpException } from '@nestjs/common';
import { normalizeSizeBreakdown, sizeBreakdownTotal } from './garment-sizes';
import { assertMockupConfigShape } from './mockup-validation';

describe('garment-sizes', () => {
  it('null/undefined → null (compatibilidad con datos viejos)', () => {
    expect(normalizeSizeBreakdown(undefined)).toBeNull();
    expect(normalizeSizeBreakdown(null)).toBeNull();
  });

  it('normaliza descartando ceros y cortes vacíos', () => {
    const b = normalizeSizeBreakdown({
      general: { S: 5, M: 2, L: 3, XL: 0 },
      mujer: { S: 0 },
    });
    expect(b).toEqual({ general: { S: 5, M: 2, L: 3 } });
    expect(sizeBreakdownTotal(b)).toBe(10);
  });

  it('todo en cero → null', () => {
    expect(normalizeSizeBreakdown({ youth: { M: 0 } })).toBeNull();
  });

  it.each([
    ['no objeto', [1]],
    ['corte desconocido', { nino: { S: 1 } }],
    ['talla desconocida', { general: { XXL: 1 } }],
    ['negativo', { general: { S: -1 } }],
    ['decimal', { general: { S: 1.5 } }],
    ['string', { general: { S: '2' } }],
    ['fila no objeto', { general: 3 }],
  ])('rechaza %s', (_l, v) => {
    expect(() => normalizeSizeBreakdown(v)).toThrow(HttpException);
  });

  it('suma varios cortes', () => {
    expect(
      sizeBreakdownTotal(
        normalizeSizeBreakdown({ general: { M: 5 }, mujer: { S: 3 } }),
      ),
    ).toBe(8);
  });
});

describe('assertMockupConfigShape con tallas', () => {
  const base = { garment: 'tshirt', colors: {}, layers: [] };
  it('acepta config sin tallas (mockups viejos)', () => {
    expect(() =>
      assertMockupConfigShape(base, 'tshirt', 'del mockup'),
    ).not.toThrow();
  });
  it('acepta tallas válidas', () => {
    expect(() =>
      assertMockupConfigShape(
        { ...base, sizes: { general: { S: 1 } } },
        'tshirt',
        'del mockup',
      ),
    ).not.toThrow();
  });
  it('rechaza tallas inválidas', () => {
    expect(() =>
      assertMockupConfigShape(
        { ...base, sizes: { general: { Q: 1 } } },
        'tshirt',
        'del mockup',
      ),
    ).toThrow(/Las tallas del mockup/);
  });
});

describe('OrderService - líneas con tallas', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { OrderService } = require('src/order/order.service');
  const svc: any = Object.create(OrderService.prototype);

  it('guarda tallas normalizadas y null (DbNull) sin tallas', () => {
    const { Prisma } = jest.requireActual('@prisma/client');
    expect(
      svc.toOrderProductData({
        customName: ' Playera ',
        quantity: 3,
        sizes: { general: { S: 3, M: 0 } },
      }),
    ).toEqual({
      customName: 'Playera',
      quantity: 3,
      sizes: { general: { S: 3 } },
    });
    expect(
      svc.toOrderProductData({ customName: 'Lona', quantity: 1 }).sizes,
    ).toBe(Prisma.DbNull);
  });

  it('rechaza si el total de tallas no coincide con la cantidad', () => {
    expect(() =>
      svc.assertOrderProductsValid([
        { customName: 'Hoodie', quantity: 4, sizes: { general: { M: 3 } } },
      ]),
    ).toThrow(/no coincide/);
    expect(() =>
      svc.assertOrderProductsValid([
        {
          customName: 'Hoodie',
          quantity: 8,
          sizes: { general: { M: 5 }, mujer: { S: 3 } },
        },
        { customName: 'Lona', quantity: 2 },
      ]),
    ).not.toThrow();
  });
});
