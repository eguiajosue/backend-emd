import {
  areaRoom,
  belongsToArea,
  normalizeAccessPayload,
  productionAreasOf,
} from './area-access';

describe('normalizeAccessPayload', () => {
  it('deja intacta una sesión que ya trae áreas', () => {
    expect(
      normalizeAccessPayload({ sub: 1, roles: ['recepcion'], areas: ['dtf'] }),
    ).toEqual({ sub: 1, roles: ['recepcion'], areas: ['dtf'] });
  });

  it('separa las áreas de los roles en un token emitido antes del cambio', () => {
    expect(
      normalizeAccessPayload({ sub: 1, roles: ['recepcion', 'diseno', 'dtf'] }),
    ).toEqual({ sub: 1, roles: ['recepcion'], areas: ['diseno', 'dtf'] });
  });

  it('tolera un payload sin roles', () => {
    const payload: { sub: number; roles?: string[] } = { sub: 1 };
    expect(normalizeAccessPayload(payload)).toEqual({
      sub: 1,
      roles: [],
      areas: [],
    });
  });
});

describe('pertenencia a un área', () => {
  it('Diseño no es un área de producción', () => {
    expect(productionAreasOf({ areas: ['diseno', 'bordado'] })).toEqual([
      'bordado',
    ]);
  });

  it('belongsToArea compara contra las áreas, no contra los roles', () => {
    expect(belongsToArea({ roles: ['taller'], areas: [] }, 'taller')).toBe(
      false,
    );
    expect(belongsToArea({ roles: [], areas: ['taller'] }, 'taller')).toBe(
      true,
    );
    expect(belongsToArea({ roles: [], areas: ['taller'] }, null)).toBe(false);
  });

  it('la sala de un área no choca con la de un rol', () => {
    expect(areaRoom('recepcion')).toBe('area:recepcion');
  });
});
