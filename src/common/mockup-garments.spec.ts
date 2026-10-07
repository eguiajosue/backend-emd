import {
  isMockupGarment,
  isMockupVehicle,
  isMockupVehiclePart,
  MOCKUP_VEHICLE_PARTS,
  MOCKUP_GARMENT_MESSAGE,
  MOCKUP_GARMENTS,
} from './mockup-garments';

describe('MOCKUP_GARMENTS', () => {
  it('incluye termo, taza y las rotulaciones además de las prendas', () => {
    expect(MOCKUP_GARMENTS).toEqual([
      'tshirt',
      'cap',
      'hoodie',
      'dress-shirt',
      'termo',
      'taza',
      'car',
      'minivan',
      'pickup',
      'trailer',
      'bicycle',
    ]);
  });

  it.each(['car', 'minivan', 'pickup', 'trailer', 'bicycle'])(
    'acepta el vehículo %s',
    (g) => {
      expect(isMockupGarment(g)).toBe(true);
      expect(isMockupVehicle(g)).toBe(true);
    },
  );

  it.each(['tshirt', 'termo', 'bus', ''])('%p no es un vehículo', (g) => {
    expect(isMockupVehicle(g)).toBe(false);
  });

  it('las partes del tráiler son completo, cabina y caja', () => {
    expect(MOCKUP_VEHICLE_PARTS).toEqual(['full', 'cab', 'box']);
    expect(isMockupVehiclePart('cab')).toBe(true);
    expect(isMockupVehiclePart('rueda')).toBe(false);
    expect(isMockupVehiclePart(undefined)).toBe(false);
  });

  it.each(['termo', 'taza', 'tshirt'])('acepta %s', (g) => {
    expect(isMockupGarment(g)).toBe(true);
  });

  it.each(['vaso', '', null, 3])('rechaza %p', (g) => {
    expect(isMockupGarment(g)).toBe(false);
  });

  it('el mensaje menciona los vehículos', () => {
    for (const word of ['carro', 'minivan', 'pickup', 'tráiler', 'bicicleta']) {
      expect(MOCKUP_GARMENT_MESSAGE).toMatch(new RegExp(word));
    }
  });

  it('el mensaje menciona termo y taza', () => {
    expect(MOCKUP_GARMENT_MESSAGE).toMatch(/termo/);
    expect(MOCKUP_GARMENT_MESSAGE).toMatch(/taza/);
  });
});
