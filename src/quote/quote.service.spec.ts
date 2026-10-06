import { HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateQuoteDto, UpdateQuoteDto } from './dto/quote.dto';
import { QUOTE_ORDER_BY, QuoteService } from './quote.service';
import { accentVariants, quoteSearchWhere } from './quote-search';

const CREATED_AT = new Date('2026-10-05T12:00:00.000Z');
const UPDATED_AT = new Date('2026-10-05T13:00:00.000Z');
const NOW = new Date('2026-10-05T15:30:00.000Z');

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  clientId: null,
  clientName: 'Taller Pérez',
  description: '50 playeras bordadas',
  stage: 'por_enviar',
  status: 'lista',
  comment: null,
  priorityDate: null,
  sentAt: null,
  orderId: null,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  createdBy: { id: 7, firstName: 'Ana', lastName: 'Ruiz', username: 'ana' },
  ...overrides,
});

const RESPONSE = {
  id: 10,
  clientId: null,
  clientName: 'Taller Pérez',
  description: '50 playeras bordadas',
  stage: 'por_enviar',
  status: 'lista',
  comment: null,
  priorityDate: null,
  sentAt: null,
  orderId: null,
  createdAt: '2026-10-05T12:00:00.000Z',
  updatedAt: '2026-10-05T13:00:00.000Z',
  createdBy: { id: 7, name: 'Ana Ruiz' },
};

const createDto = (
  overrides: Partial<Record<keyof CreateQuoteDto, unknown>> = {},
) =>
  ({
    clientName: 'Taller Pérez',
    description: '50 playeras bordadas',
    ...overrides,
  }) as CreateQuoteDto;

const current = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  clientId: null,
  clientName: 'Taller Pérez',
  stage: 'por_enviar',
  status: 'lista',
  sentAt: null,
  ...overrides,
});

describe('QuoteService', () => {
  let service: QuoteService;
  let prisma: {
    quote: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
    client: { findMany: jest.Mock };
    order: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    prisma = {
      quote: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(row()),
        update: jest.fn().mockResolvedValue(row()),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      client: { findMany: jest.fn().mockResolvedValue([]) },
      order: { findUnique: jest.fn().mockResolvedValue(null) },
      // Forma de array: resuelve las operaciones (ya "ejecutadas" por el mock).
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    service = new QuoteService(prisma as unknown as PrismaService);
  });

  afterEach(() => jest.useRealTimers());

  /** Ejecuta `fn` y devuelve la HttpException que lanza. */
  const errorOf = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      return error as HttpException;
    }
    throw new Error('Se esperaba una HttpException');
  };
  const statusOf = async (fn: () => Promise<unknown>) =>
    (await errorOf(fn)).getStatus();

  describe('create', () => {
    it('sin etapa ni subestado queda por_enviar / lista, sin sentAt, con autor', async () => {
      const result = await service.create(
        createDto({
          clientName: '  Taller Pérez ',
          description: ' 50 playeras bordadas ',
        }),
        7,
      );

      const args = prisma.quote.create.mock.calls[0][0];
      expect(args.data).toEqual({
        clientId: null,
        clientName: 'Taller Pérez',
        description: '50 playeras bordadas',
        stage: 'por_enviar',
        status: 'lista',
        comment: null,
        priorityDate: null,
        sentAt: null,
        createdById: 7,
      });
      expect(args.select.createdBy).toEqual({
        select: { id: true, firstName: true, lastName: true, username: true },
      });
      expect(prisma.client.findMany).not.toHaveBeenCalled();
      expect(result).toEqual(RESPONSE);
    });

    it('etapa enviada sin subestado → esperando_respuesta y sentAt = ahora', async () => {
      await service.create(createDto({ stage: 'enviada' }), 7);
      const { data } = prisma.quote.create.mock.calls[0][0];
      expect(data.stage).toBe('enviada');
      expect(data.status).toBe('esperando_respuesta');
      expect(data.sentAt).toEqual(NOW);
    });

    it('sólo el subestado deduce la etapa', async () => {
      await service.create(createDto({ status: 'aceptada' }), 7);
      const { data } = prisma.quote.create.mock.calls[0][0];
      expect(data).toMatchObject({ stage: 'enviada', status: 'aceptada' });
      expect(data.sentAt).toEqual(NOW);
    });

    it('guarda prioridad (DATE a medianoche UTC) y comentario', async () => {
      prisma.quote.create.mockResolvedValue(
        row({
          priorityDate: new Date('2026-10-06T00:00:00.000Z'),
          comment: 'Llamar antes',
          stage: 'enviada',
          status: 'comentarios',
          sentAt: NOW,
        }),
      );
      const result = await service.create(
        createDto({
          stage: 'enviada',
          status: 'comentarios',
          priorityDate: '2026-10-06',
          comment: ' Llamar antes ',
        }),
        7,
      );
      const { data } = prisma.quote.create.mock.calls[0][0];
      expect(data.priorityDate).toEqual(new Date('2026-10-06T00:00:00.000Z'));
      expect(data.comment).toBe('Llamar antes');
      expect(result.priorityDate).toBe('2026-10-06');
      expect(result.sentAt).toBe(NOW.toISOString());
      expect(result.comment).toBe('Llamar antes');
    });

    it('comentario vacío se guarda como null', async () => {
      await service.create(createDto({ comment: '   ' }), 7);
      expect(prisma.quote.create.mock.calls[0][0].data.comment).toBeNull();
    });

    it.each<[string, Partial<Record<keyof CreateQuoteDto, unknown>>]>([
      ['subestado de otra etapa', { stage: 'por_enviar', status: 'aceptada' }],
      [
        'subestado de otra etapa (enviada)',
        { stage: 'enviada', status: 'lista' },
      ],
      ['etapa inválida', { stage: 'archivada' }],
      ['subestado inválido', { status: 'perdida' }],
      ['cliente vacío sin clientId', { clientName: '   ' }],
      ['sin cliente', { clientName: undefined }],
      ['cliente de más de 120 caracteres', { clientName: 'x'.repeat(121) }],
      ['descripción vacía', { description: '  ' }],
      ['descripción de más de 1000', { description: 'x'.repeat(1001) }],
      ['comentario de más de 1000', { comment: 'x'.repeat(1001) }],
      ['fecha con otro formato', { priorityDate: '06/10/2026' }],
      ['fecha inexistente', { priorityDate: '2026-02-30' }],
      ['NUL en la descripción', { description: 'hola\u0000' }],
      ['NUL en el cliente', { clientName: 'Ana\u0000' }],
      ['NUL en el comentario', { comment: '\u0000' }],
      ['clientId no entero', { clientId: 1.5 }],
    ])('400 con %s', async (_name, overrides) => {
      expect(
        await statusOf(() => service.create(createDto(overrides), 7)),
      ).toBe(HttpStatus.BAD_REQUEST);
      expect(prisma.quote.create).not.toHaveBeenCalled();
    });

    it('mensaje en español si el subestado no corresponde a la etapa', async () => {
      const error = await errorOf(() =>
        service.create(
          createDto({ stage: 'por_enviar', status: 'aceptada' }),
          7,
        ),
      );
      expect(error.message).toBe(
        'El subestado "aceptada" no corresponde a la etapa "por_enviar"',
      );
    });

    describe('clientId', () => {
      it('con nombre vacío lo completa con nombre y apellido del cliente', async () => {
        prisma.client.findMany.mockResolvedValue([
          { id: 3, first_name: 'José', last_name: 'Peña' },
        ]);
        await service.create(createDto({ clientId: 3, clientName: '' }), 7);

        expect(prisma.client.findMany.mock.calls[0][0].where).toEqual({
          id: { in: [3] },
        });
        const { data } = prisma.quote.create.mock.calls[0][0];
        expect(data).toMatchObject({ clientId: 3, clientName: 'José Peña' });
      });

      it('sin apellido usa sólo el nombre; sin clientName también completa', async () => {
        prisma.client.findMany.mockResolvedValue([
          { id: 3, first_name: 'Escuela Norte', last_name: null },
        ]);
        await service.create(
          createDto({ clientId: 3, clientName: undefined }),
          7,
        );
        expect(prisma.quote.create.mock.calls[0][0].data.clientName).toBe(
          'Escuela Norte',
        );
      });

      it('respeta el nombre escrito aunque venga clientId', async () => {
        prisma.client.findMany.mockResolvedValue([
          { id: 3, first_name: 'José', last_name: 'Peña' },
        ]);
        await service.create(
          createDto({ clientId: 3, clientName: 'Pepe (sucursal centro)' }),
          7,
        );
        expect(prisma.quote.create.mock.calls[0][0].data).toMatchObject({
          clientId: 3,
          clientName: 'Pepe (sucursal centro)',
        });
      });

      it('404 si el cliente no existe', async () => {
        const error = await errorOf(() =>
          service.create(createDto({ clientId: 99, clientName: '' }), 7),
        );
        expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect(error.message).toBe('El cliente #99 no existe');
        expect(prisma.quote.create).not.toHaveBeenCalled();
      });

      it('clientId null = cliente libre', async () => {
        await service.create(createDto({ clientId: null }), 7);
        expect(prisma.client.findMany).not.toHaveBeenCalled();
        expect(prisma.quote.create.mock.calls[0][0].data.clientId).toBeNull();
      });
    });
  });

  describe('createBulk', () => {
    it('crea todas en UNA transacción y devuelve las creadas en orden', async () => {
      prisma.client.findMany.mockResolvedValue([
        { id: 3, first_name: 'José', last_name: 'Peña' },
      ]);
      prisma.quote.create
        .mockResolvedValueOnce(row({ id: 1 }))
        .mockResolvedValueOnce(
          row({ id: 2, clientId: 3, clientName: 'José Peña' }),
        )
        .mockResolvedValueOnce(
          row({
            id: 3,
            stage: 'enviada',
            status: 'esperando_respuesta',
            sentAt: NOW,
          }),
        );

      const result = await service.createBulk(
        {
          items: [
            createDto(),
            createDto({ clientId: 3, clientName: '' }),
            createDto({ clientId: 3, clientName: '', stage: 'enviada' }),
          ],
        },
        7,
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(3);
      // Los clientes repetidos se buscan una sola vez.
      expect(prisma.client.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.client.findMany.mock.calls[0][0].where).toEqual({
        id: { in: [3] },
      });
      const datas = prisma.quote.create.mock.calls.map((c) => c[0].data);
      expect(datas.map((d) => d.clientName)).toEqual([
        'Taller Pérez',
        'José Peña',
        'José Peña',
      ]);
      expect(datas[2]).toMatchObject({
        stage: 'enviada',
        status: 'esperando_respuesta',
        sentAt: NOW,
        createdById: 7,
      });
      expect(result.map((q) => q.id)).toEqual([1, 2, 3]);
      expect(result[2].sentAt).toBe(NOW.toISOString());
    });

    it('400 si no hay ítems o son más de 100', async () => {
      expect(await statusOf(() => service.createBulk({ items: [] }, 7))).toBe(
        HttpStatus.BAD_REQUEST,
      );
      expect(
        await statusOf(() =>
          service.createBulk(
            { items: Array.from({ length: 101 }, () => createDto()) },
            7,
          ),
        ),
      ).toBe(HttpStatus.BAD_REQUEST);
      expect(
        await statusOf(() =>
          service.createBulk({ items: undefined } as never, 7),
        ),
      ).toBe(HttpStatus.BAD_REQUEST);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('acepta exactamente 100', async () => {
      await service.createBulk(
        { items: Array.from({ length: 100 }, () => createDto()) },
        7,
      );
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(100);
    });

    it('un ítem inválido no crea ninguno y el mensaje dice cuál', async () => {
      const error = await errorOf(() =>
        service.createBulk(
          { items: [createDto(), createDto({ description: '' })] },
          7,
        ),
      );
      expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(error.message).toMatch(
        /^Cotización 2: La descripción es obligatoria/,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.quote.create).not.toHaveBeenCalled();
    });

    it('404 (con número de ítem) si un cliente no existe', async () => {
      const error = await errorOf(() =>
        service.createBulk(
          { items: [createDto(), createDto({ clientId: 42, clientName: '' })] },
          7,
        ),
      );
      expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect(error.message).toBe('Cotización 2: El cliente #42 no existe');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('si la transacción falla no devuelve nada a medias', async () => {
      prisma.$transaction.mockRejectedValue(new Error('db caída'));
      await expect(
        service.createBulk({ items: [createDto(), createDto()] }, 7),
      ).rejects.toThrow('db caída');
    });
  });

  describe('findAll', () => {
    it('sin filtros: where vacío y orden prioridad (nulls last) → updatedAt desc', async () => {
      prisma.quote.findMany.mockResolvedValue([
        row({ id: 1, priorityDate: new Date('2026-10-04T00:00:00.000Z') }),
        row({ id: 2, createdBy: null }),
      ]);
      const result = await service.findAll({});

      const args = prisma.quote.findMany.mock.calls[0][0];
      expect(args.where).toEqual({});
      expect(args.orderBy).toEqual([
        { priorityDate: { sort: 'asc', nulls: 'last' } },
        { updatedAt: 'desc' },
        { id: 'desc' },
      ]);
      expect(args.orderBy).toBe(QUOTE_ORDER_BY);
      expect(result).toEqual([
        { ...RESPONSE, id: 1, priorityDate: '2026-10-04' },
        { ...RESPONSE, id: 2, createdBy: null },
      ]);
    });

    it('filtra por etapa y subestado', async () => {
      await service.findAll({ stage: 'enviada', status: 'aceptada' });
      expect(prisma.quote.findMany.mock.calls[0][0].where).toEqual({
        stage: 'enviada',
        status: 'aceptada',
      });
    });

    it('400 si el subestado no es de la etapa filtrada', async () => {
      expect(
        await statusOf(() =>
          service.findAll({ stage: 'enviada', status: 'lista' }),
        ),
      ).toBe(HttpStatus.BAD_REQUEST);
    });

    it('q: cada palabra en cliente o descripción, insensible a mayúsculas', async () => {
      await service.findAll({ q: '  jose  gorras ' });
      const { where } = prisma.quote.findMany.mock.calls[0][0];
      expect(where.AND).toHaveLength(1);
      const terms = where.AND[0].AND;
      expect(terms).toHaveLength(2);
      expect(terms[0].OR).toEqual(
        expect.arrayContaining([
          { clientName: { contains: 'jose', mode: 'insensitive' } },
          { description: { contains: 'jose', mode: 'insensitive' } },
          { clientName: { contains: 'josé', mode: 'insensitive' } },
        ]),
      );
      expect(terms[1].OR).toEqual(
        expect.arrayContaining([
          { description: { contains: 'gorras', mode: 'insensitive' } },
        ]),
      );
    });

    it('q vacío no filtra', async () => {
      await service.findAll({ q: '   ' });
      expect(prisma.quote.findMany.mock.calls[0][0].where).toEqual({});
    });

    it('400 con NUL en la búsqueda', async () => {
      expect(await statusOf(() => service.findAll({ q: 'a\u0000' }))).toBe(
        HttpStatus.BAD_REQUEST,
      );
    });
  });

  describe('búsqueda sin acentos (best effort)', () => {
    it('variantes de una palabra: tal cual, sin acentos y con una tilde', () => {
      expect(accentVariants('jose')).toEqual(
        expect.arrayContaining(['jose', 'jóse', 'josé']),
      );
      expect(accentVariants('Peña')).toEqual(
        expect.arrayContaining(['Peña', 'pena', 'peña']),
      );
      expect(accentVariants('Pérez')).toEqual(
        expect.arrayContaining(['Pérez', 'perez', 'pérez']),
      );
      expect(accentVariants('pinguino')).toContain('pingüino');
    });

    it('null si no hay palabras; tope de 6 palabras', () => {
      expect(quoteSearchWhere(undefined)).toBeNull();
      expect(quoteSearchWhere('  ')).toBeNull();
      const where = quoteSearchWhere('a b c d e f g h') as { AND: unknown[] };
      expect(where.AND).toHaveLength(6);
    });
  });

  describe('update', () => {
    it('404 si no existe', async () => {
      expect(
        await statusOf(() => service.update(99, { description: 'x' })),
      ).toBe(HttpStatus.NOT_FOUND);
      expect(prisma.quote.update).not.toHaveBeenCalled();
    });

    it('pasar a enviada sin subestado → esperando_respuesta y sentAt = ahora', async () => {
      prisma.quote.findUnique.mockResolvedValue(current());
      await service.update(10, { stage: 'enviada' });
      const args = prisma.quote.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 10 });
      expect(args.data).toEqual({
        stage: 'enviada',
        status: 'esperando_respuesta',
        sentAt: NOW,
      });
    });

    it('pasar a enviada conserva el sentAt que ya tenía', async () => {
      prisma.quote.findUnique.mockResolvedValue(
        current({ sentAt: new Date('2026-10-01T10:00:00.000Z') }),
      );
      await service.update(10, { stage: 'enviada', status: 'comentarios' });
      const { data } = prisma.quote.update.mock.calls[0][0];
      expect(data).toEqual({ stage: 'enviada', status: 'comentarios' });
    });

    it('volver a por_enviar → lista y limpia sentAt', async () => {
      prisma.quote.findUnique.mockResolvedValue(
        current({ stage: 'enviada', status: 'no_aceptada', sentAt: NOW }),
      );
      await service.update(10, { stage: 'por_enviar' });
      expect(prisma.quote.update.mock.calls[0][0].data).toEqual({
        stage: 'por_enviar',
        status: 'lista',
        sentAt: null,
      });
    });

    it('misma etapa sin subestado conserva el subestado actual', async () => {
      prisma.quote.findUnique.mockResolvedValue(
        current({ stage: 'enviada', status: 'aceptada', sentAt: NOW }),
      );
      await service.update(10, { stage: 'enviada' });
      expect(prisma.quote.update.mock.calls[0][0].data).toEqual({
        stage: 'enviada',
        status: 'aceptada',
      });
    });

    it('sólo subestado dentro de la etapa (cambio en un clic)', async () => {
      prisma.quote.findUnique.mockResolvedValue(current());
      await service.update(10, { status: 'pendiente_medidas' });
      expect(prisma.quote.update.mock.calls[0][0].data).toEqual({
        stage: 'por_enviar',
        status: 'pendiente_medidas',
        sentAt: null,
      });
    });

    it('dejar de estar aceptada conserva el pedido ligado (decisión de producto)', async () => {
      prisma.quote.findUnique.mockResolvedValue(
        current({
          stage: 'enviada',
          status: 'aceptada',
          sentAt: NOW,
          orderId: 42,
        }),
      );
      await service.update(10, { status: 'comentarios' });
      expect(prisma.quote.update.mock.calls[0][0].data).not.toHaveProperty(
        'orderId',
      );
    });

    it('400 si el subestado no corresponde a la etapa', async () => {
      prisma.quote.findUnique.mockResolvedValue(current());
      expect(
        await statusOf(() =>
          service.update(10, { stage: 'por_enviar', status: 'aceptada' }),
        ),
      ).toBe(HttpStatus.BAD_REQUEST);
      expect(prisma.quote.update).not.toHaveBeenCalled();
    });

    it('prioridad, comentario y descripción; null limpia prioridad y comentario', async () => {
      prisma.quote.findUnique.mockResolvedValue(current());
      await service.update(10, {
        priorityDate: '2026-10-07',
        comment: ' ok ',
        description: ' 30 gorras ',
      });
      expect(prisma.quote.update.mock.calls[0][0].data).toEqual({
        priorityDate: new Date('2026-10-07T00:00:00.000Z'),
        comment: 'ok',
        description: '30 gorras',
      });

      await service.update(10, { priorityDate: null, comment: null });
      expect(prisma.quote.update.mock.calls[1][0].data).toEqual({
        priorityDate: null,
        comment: null,
      });
    });

    it('cambiar a un cliente registrado sin nombre muestra el del cliente', async () => {
      prisma.quote.findUnique.mockResolvedValue(current());
      prisma.client.findMany.mockResolvedValue([
        { id: 5, first_name: 'Ana', last_name: 'Gómez' },
      ]);
      await service.update(10, { clientId: 5 });
      expect(prisma.quote.update.mock.calls[0][0].data).toEqual({
        clientId: 5,
        clientName: 'Ana Gómez',
      });
    });

    it('nombre vacío con cliente registrado actual → nombre del cliente', async () => {
      prisma.quote.findUnique.mockResolvedValue(current({ clientId: 5 }));
      prisma.client.findMany.mockResolvedValue([
        { id: 5, first_name: 'Ana', last_name: 'Gómez' },
      ]);
      await service.update(10, { clientName: '' });
      expect(prisma.quote.update.mock.calls[0][0].data).toEqual({
        clientName: 'Ana Gómez',
      });
    });

    it('clientId null desliga el cliente y conserva el nombre', async () => {
      prisma.quote.findUnique.mockResolvedValue(current({ clientId: 5 }));
      await service.update(10, { clientId: null });
      expect(prisma.quote.update.mock.calls[0][0].data).toEqual({
        clientId: null,
      });
    });

    it.each<[string, Partial<Record<keyof UpdateQuoteDto, unknown>>]>([
      ['nombre vacío sin cliente registrado', { clientName: '  ' }],
      ['nombre null', { clientName: null }],
      ['descripción vacía', { description: '' }],
      ['descripción null', { description: null }],
      ['etapa null', { stage: null }],
      ['fecha inválida', { priorityDate: '2026-13-01' }],
      ['NUL en el comentario', { comment: 'a\u0000b' }],
    ])('400 con %s', async (_name, dto) => {
      prisma.quote.findUnique.mockResolvedValue(current());
      expect(
        await statusOf(() => service.update(10, dto as UpdateQuoteDto)),
      ).toBe(HttpStatus.BAD_REQUEST);
      expect(prisma.quote.update).not.toHaveBeenCalled();
    });

    it('404 si el nuevo cliente no existe', async () => {
      prisma.quote.findUnique.mockResolvedValue(current());
      expect(await statusOf(() => service.update(10, { clientId: 77 }))).toBe(
        HttpStatus.NOT_FOUND,
      );
    });

    it('404 si se borró entre la lectura y el update (P2025)', async () => {
      prisma.quote.findUnique.mockResolvedValue(current());
      prisma.quote.update.mockRejectedValue({ code: 'P2025' });
      expect(await statusOf(() => service.update(10, { comment: 'x' }))).toBe(
        HttpStatus.NOT_FOUND,
      );
    });
  });

  describe('linkOrder', () => {
    it('liga el pedido a una cotización aceptada', async () => {
      prisma.quote.findUnique
        .mockResolvedValueOnce({ id: 10, status: 'aceptada' })
        .mockResolvedValueOnce(null);
      prisma.order.findUnique.mockResolvedValue({ id: 55 });
      prisma.quote.update.mockResolvedValue(
        row({ stage: 'enviada', status: 'aceptada', sentAt: NOW, orderId: 55 }),
      );

      const result = await service.linkOrder(10, 55);

      expect(prisma.order.findUnique.mock.calls[0][0].where).toEqual({
        id: 55,
      });
      expect(prisma.quote.findUnique.mock.calls[1][0].where).toEqual({
        orderId: 55,
      });
      expect(prisma.quote.update.mock.calls[0][0]).toMatchObject({
        where: { id: 10 },
        data: { orderId: 55 },
      });
      expect(result.orderId).toBe(55);
    });

    it('es idempotente si el pedido ya está ligado a esta misma cotización', async () => {
      prisma.quote.findUnique
        .mockResolvedValueOnce({ id: 10, status: 'aceptada' })
        .mockResolvedValueOnce({ id: 10 });
      prisma.order.findUnique.mockResolvedValue({ id: 55 });
      await service.linkOrder(10, 55);
      expect(prisma.quote.update).toHaveBeenCalled();
    });

    it('404 si la cotización no existe', async () => {
      expect(await statusOf(() => service.linkOrder(99, 55))).toBe(
        HttpStatus.NOT_FOUND,
      );
    });

    it.each(['lista', 'esperando_respuesta', 'no_aceptada', 'comentarios'])(
      '400 si el subestado es %s (no aceptada)',
      async (status) => {
        prisma.quote.findUnique.mockResolvedValue({ id: 10, status });
        const error = await errorOf(() => service.linkOrder(10, 55));
        expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(error.message).toBe(
          'Sólo se puede ligar un pedido a una cotización aceptada',
        );
        expect(prisma.order.findUnique).not.toHaveBeenCalled();
      },
    );

    it('404 si el pedido no existe', async () => {
      prisma.quote.findUnique.mockResolvedValue({ id: 10, status: 'aceptada' });
      const error = await errorOf(() => service.linkOrder(10, 55));
      expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect(error.message).toBe('El pedido #55 no existe');
      expect(prisma.quote.update).not.toHaveBeenCalled();
    });

    it('409 si el pedido ya está ligado a otra cotización', async () => {
      prisma.quote.findUnique
        .mockResolvedValueOnce({ id: 10, status: 'aceptada' })
        .mockResolvedValueOnce({ id: 11 });
      prisma.order.findUnique.mockResolvedValue({ id: 55 });
      expect(await statusOf(() => service.linkOrder(10, 55))).toBe(
        HttpStatus.CONFLICT,
      );
      expect(prisma.quote.update).not.toHaveBeenCalled();
    });

    it('409 si otra cotización lo tomó en carrera (P2002 del índice único)', async () => {
      prisma.quote.findUnique
        .mockResolvedValueOnce({ id: 10, status: 'aceptada' })
        .mockResolvedValueOnce(null);
      prisma.order.findUnique.mockResolvedValue({ id: 55 });
      prisma.quote.update.mockRejectedValue({ code: 'P2002' });
      expect(await statusOf(() => service.linkOrder(10, 55))).toBe(
        HttpStatus.CONFLICT,
      );
    });
  });

  describe('remove', () => {
    it('borra por id', async () => {
      await expect(service.remove(10)).resolves.toBeUndefined();
      expect(prisma.quote.deleteMany).toHaveBeenCalledWith({
        where: { id: 10 },
      });
    });

    it('404 si no existe', async () => {
      prisma.quote.deleteMany.mockResolvedValue({ count: 0 });
      expect(await statusOf(() => service.remove(99))).toBe(
        HttpStatus.NOT_FOUND,
      );
    });
  });
});
