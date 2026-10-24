import {
  assertValidFieldList,
  assertValidMachineList,
  missingRequired,
  validateFieldValues,
  type AreaFieldView,
} from './area-config';

const field = (over: Partial<AreaFieldView>): AreaFieldView => ({
  id: 1,
  key: 'material',
  label: 'Material',
  type: 'text',
  required: false,
  options: [],
  unit: null,
  ...over,
});

describe('assertValidMachineList', () => {
  it('acepta una lista vacía y nombres distintos', () => {
    expect(() => assertValidMachineList([])).not.toThrow();
    expect(() =>
      assertValidMachineList([
        { name: 'Impresora 1' },
        { name: 'Impresora 2' },
      ]),
    ).not.toThrow();
  });

  it.each([
    [
      'nombres repetidos (sin importar mayúsculas)',
      [{ name: 'Láser A' }, { name: 'láser a' }],
      /repetido/,
    ],
    ['nombre muy corto', [{ name: 'a' }], /entre 2 y 40/],
    [
      'demasiadas',
      Array.from({ length: 13 }, (_, i) => ({ name: `Máquina ${i}` })),
      /hasta 12/,
    ],
  ])('rechaza %s', (_l, list, message) => {
    expect(() => assertValidMachineList(list)).toThrow(message);
  });
});

describe('assertValidFieldList', () => {
  it('acepta datos de cada tipo', () => {
    expect(() =>
      assertValidFieldList([
        {
          label: 'Material',
          type: 'select',
          options: ['PLA', 'ABS'],
          required: true,
        },
        { label: 'Alto', type: 'number', unit: 'cm' },
        { label: 'Notas', type: 'text' },
        { label: 'Con soporte', type: 'boolean' },
      ]),
    ).not.toThrow();
  });

  it.each([
    [
      'una lista con menos de 2 opciones',
      [{ label: 'Material', type: 'select' as const, options: ['PLA'] }],
      /entre 2 y 10 opciones/,
    ],
    [
      'opciones repetidas',
      [{ label: 'Material', type: 'select' as const, options: ['PLA', 'pla'] }],
      /distintas/,
    ],
    [
      'opciones en un dato que no es lista',
      [{ label: 'Notas', type: 'text' as const, options: ['a1', 'b2'] }],
      /de tipo lista/,
    ],
    [
      'unidad en un dato no numérico',
      [{ label: 'Notas', type: 'text' as const, unit: 'cm' }],
      /numéricos/,
    ],
    [
      'un sí/no obligatorio',
      [{ label: 'Soporte', type: 'boolean' as const, required: true }],
      /no puede ser obligatorio/,
    ],
    [
      'etiquetas repetidas',
      [
        { label: 'Alto', type: 'number' as const },
        { label: 'alto', type: 'text' as const },
      ],
      /repetido/,
    ],
    [
      'demasiados',
      Array.from({ length: 11 }, (_, i) => ({
        label: `Dato ${i}`,
        type: 'text' as const,
      })),
      /hasta 10/,
    ],
  ])('rechaza %s', (_l, list, message) => {
    expect(() => assertValidFieldList(list)).toThrow(message);
  });
});

describe('validateFieldValues', () => {
  const fields = [
    field({
      key: 'material',
      label: 'Material',
      type: 'select',
      options: ['PLA', 'ABS'],
    }),
    field({ id: 2, key: 'alto', label: 'Alto', type: 'number', unit: 'cm' }),
    field({ id: 3, key: 'notas', label: 'Notas', type: 'text' }),
    field({ id: 4, key: 'soporte', label: 'Soporte', type: 'boolean' }),
  ];

  it('acepta valores válidos y recorta el texto', () => {
    expect(
      validateFieldValues(fields, {
        material: 'PLA',
        alto: 12.5,
        notas: '  hola ',
        soporte: false,
      }),
    ).toEqual({ material: 'PLA', alto: 12.5, notas: 'hola', soporte: false });
  });

  it('un valor vacío no se guarda', () => {
    expect(validateFieldValues(fields, { material: null, notas: '' })).toEqual(
      {},
    );
  });

  it.each([
    [{ otro: 'x' }, /no existe/],
    [{ material: 'PETG' }, /debe ser una de: PLA, ABS/],
    [{ alto: '12' }, /debe ser un número/],
    [{ alto: Infinity }, /debe ser un número/],
    [{ notas: 'x'.repeat(201) }, /hasta 200/],
    [{ soporte: 'sí' }, /sí o no/],
  ])('rechaza %j', (values, message) => {
    expect(() => validateFieldValues(fields, values)).toThrow(message);
  });
});

describe('missingRequired', () => {
  const fields = [
    field({ key: 'material', label: 'Material', required: true }),
    field({ id: 2, key: 'notas', label: 'Notas' }),
  ];
  it('lista los obligatorios sin valor', () => {
    expect(missingRequired(fields, null).map((f) => f.key)).toEqual([
      'material',
    ]);
    expect(missingRequired(fields, { material: 'PLA' })).toEqual([]);
    expect(missingRequired(fields, { notas: 'x' }).map((f) => f.key)).toEqual([
      'material',
    ]);
  });
});
