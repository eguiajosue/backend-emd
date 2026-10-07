import {
  isMockupGarment,
  MOCKUP_GARMENT_MESSAGE,
  MOCKUP_GARMENTS,
} from './mockup-garments';

describe('MOCKUP_GARMENTS', () => {
  it('incluye termo y taza además de las prendas', () => {
    expect(MOCKUP_GARMENTS).toEqual([
      'tshirt',
      'cap',
      'hoodie',
      'dress-shirt',
      'termo',
      'taza',
    ]);
  });

  it.each(['termo', 'taza', 'tshirt'])('acepta %s', (g) => {
    expect(isMockupGarment(g)).toBe(true);
  });

  it.each(['vaso', '', null, 3])('rechaza %p', (g) => {
    expect(isMockupGarment(g)).toBe(false);
  });

  it('el mensaje menciona termo y taza', () => {
    expect(MOCKUP_GARMENT_MESSAGE).toMatch(/termo/);
    expect(MOCKUP_GARMENT_MESSAGE).toMatch(/taza/);
  });
});
