import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BulkCreateQuotesDto,
  CreateQuoteDto,
  LinkQuoteOrderDto,
  ListQuotesQueryDto,
  UpdateQuoteDto,
} from './quote.dto';

/** Mismo pipe que main.ts: whitelist + forbidNonWhitelisted. */
const validateAs = async <T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
) => {
  const dto = plainToInstance(cls, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, errors };
};
const errorsFor = async <T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
) => (await validateAs(cls, body)).errors.map((e) => e.property).sort();

const valid = { clientName: 'Taller Pérez', description: '50 playeras' };

describe('CreateQuoteDto', () => {
  it('acepta el alta mínima y la completa', async () => {
    expect(await errorsFor(CreateQuoteDto, valid)).toEqual([]);
    expect(
      await errorsFor(CreateQuoteDto, {
        ...valid,
        clientId: 3,
        stage: 'enviada',
        status: 'comentarios',
        priorityDate: '2026-10-06',
        comment: 'Pidió otro color',
      }),
    ).toEqual([]);
  });

  it('recorta espacios del cliente y la descripción', async () => {
    const { dto } = await validateAs(CreateQuoteDto, {
      clientName: '  Ana  ',
      description: ' 5 gorras ',
    });
    expect(dto.clientName).toBe('Ana');
    expect(dto.description).toBe('5 gorras');
  });

  it('clientName es obligatorio sin clientId, opcional (o vacío) con clientId', async () => {
    expect(await errorsFor(CreateQuoteDto, { description: 'x' })).toEqual([
      'clientName',
    ]);
    expect(
      await errorsFor(CreateQuoteDto, { description: 'x', clientId: 3 }),
    ).toEqual([]);
    expect(
      await errorsFor(CreateQuoteDto, {
        description: 'x',
        clientId: 3,
        clientName: '',
      }),
    ).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    [
      'cliente de 121 caracteres',
      { clientName: 'x'.repeat(121) },
      'clientName',
    ],
    ['descripción vacía', { description: '   ' }, 'description'],
    ['descripción de 1001', { description: 'x'.repeat(1001) }, 'description'],
    ['comentario de 1001', { comment: 'x'.repeat(1001) }, 'comment'],
    ['etapa desconocida', { stage: 'archivada' }, 'stage'],
    ['subestado desconocido', { status: 'perdida' }, 'status'],
    [
      'fecha con hora',
      { priorityDate: '2026-10-06T10:00:00Z' },
      'priorityDate',
    ],
    ['fecha inexistente', { priorityDate: '2026-02-30' }, 'priorityDate'],
    ['clientId string', { clientId: '3' }, 'clientId'],
    ['clientId negativo', { clientId: -1 }, 'clientId'],
    ['NUL en la descripción', { description: 'a\u0000' }, 'description'],
    ['NUL en el cliente', { clientName: 'a\u0000' }, 'clientName'],
    ['NUL en el comentario', { comment: 'a\u0000' }, 'comment'],
    ['campo desconocido', { orderId: 5 }, 'orderId'],
  ])('rechaza %s', async (_name, overrides, property) => {
    expect(await errorsFor(CreateQuoteDto, { ...valid, ...overrides })).toEqual(
      [property],
    );
  });

  it('acepta prioridad y comentario null', async () => {
    expect(
      await errorsFor(CreateQuoteDto, {
        ...valid,
        priorityDate: null,
        comment: null,
      }),
    ).toEqual([]);
  });

  it('mensajes en español', async () => {
    const { errors } = await validateAs(CreateQuoteDto, {
      clientName: 'Ana',
      description: '',
      priorityDate: 'mañana',
    });
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages).toEqual(
      expect.arrayContaining([
        'La descripción es obligatoria (máx. 1000 caracteres)',
        'La fecha de prioridad debe tener el formato AAAA-MM-DD',
      ]),
    );
  });
});

describe('BulkCreateQuotesDto', () => {
  it('acepta de 1 a 100 ítems', async () => {
    expect(await errorsFor(BulkCreateQuotesDto, { items: [valid] })).toEqual(
      [],
    );
    expect(
      await errorsFor(BulkCreateQuotesDto, {
        items: Array.from({ length: 100 }, () => valid),
      }),
    ).toEqual([]);
  });

  it('rechaza lista vacía, más de 100, o no-lista', async () => {
    for (const items of [[], Array.from({ length: 101 }, () => valid), 'x']) {
      expect(await errorsFor(BulkCreateQuotesDto, { items })).toEqual([
        'items',
      ]);
    }
  });

  it('valida cada ítem', async () => {
    const { errors } = await validateAs(BulkCreateQuotesDto, {
      items: [valid, { clientName: 'Ana', description: '' }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].children?.[0].property).toBe('1');
  });
});

describe('UpdateQuoteDto', () => {
  it('acepta un body vacío y cada campo por separado', async () => {
    expect(await errorsFor(UpdateQuoteDto, {})).toEqual([]);
    for (const body of [
      { stage: 'enviada' },
      { status: 'aceptada' },
      { clientId: null },
      { clientId: 4 },
      { clientName: '' },
      { priorityDate: null },
      { priorityDate: '2026-10-07' },
      { comment: null },
      { comment: '' },
      { description: 'otra' },
    ]) {
      expect(await errorsFor(UpdateQuoteDto, body)).toEqual([]);
    }
  });

  it('no acepta null en cliente, descripción, etapa ni subestado', async () => {
    expect(
      await errorsFor(UpdateQuoteDto, {
        clientName: null,
        description: null,
        stage: null,
        status: null,
      }),
    ).toEqual(['clientName', 'description', 'stage', 'status']);
  });

  it('no permite tocar orderId ni sentAt directamente', async () => {
    expect(
      await errorsFor(UpdateQuoteDto, { orderId: 1, sentAt: '2026-10-05' }),
    ).toEqual(['orderId', 'sentAt']);
  });
});

describe('LinkQuoteOrderDto', () => {
  it('exige un orderId entero positivo', async () => {
    expect(await errorsFor(LinkQuoteOrderDto, { orderId: 5 })).toEqual([]);
    for (const orderId of [undefined, 0, '5', 1.5]) {
      expect(await errorsFor(LinkQuoteOrderDto, { orderId })).toEqual([
        'orderId',
      ]);
    }
  });
});

describe('ListQuotesQueryDto', () => {
  it('filtros opcionales', async () => {
    expect(await errorsFor(ListQuotesQueryDto, {})).toEqual([]);
    expect(
      await errorsFor(ListQuotesQueryDto, {
        stage: 'por_enviar',
        status: 'info',
        q: 'josé',
      }),
    ).toEqual([]);
  });

  it('rechaza valores desconocidos, búsqueda larga o con NUL', async () => {
    expect(
      await errorsFor(ListQuotesQueryDto, {
        stage: 'x',
        status: 'y',
        q: 'x'.repeat(101),
      }),
    ).toEqual(['q', 'stage', 'status']);
    expect(await errorsFor(ListQuotesQueryDto, { q: 'a\u0000' })).toEqual([
      'q',
    ]);
  });
});
