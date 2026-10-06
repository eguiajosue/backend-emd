import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { MOCKUP_AUTHOR_SELECT, mockupAuthor } from 'src/common/mockup-author';
import {
  BulkCreateQuotesDto,
  CreateQuoteDto,
  ListQuotesQueryDto,
  UpdateQuoteDto,
} from './dto/quote.dto';
import {
  DEFAULT_QUOTE_STATUS,
  MAX_QUOTE_BULK_ITEMS,
  MAX_QUOTE_CLIENT_NAME_LENGTH,
  MAX_QUOTE_COMMENT_LENGTH,
  MAX_QUOTE_DESCRIPTION_LENGTH,
  QUOTE_ACCEPTED_STATUS,
  QUOTE_CLIENT_NAME_MESSAGE,
  QUOTE_COMMENT_MESSAGE,
  QUOTE_DESCRIPTION_MESSAGE,
  QUOTE_NUL_MESSAGE,
  QUOTE_PRIORITY_DATE_MESSAGE,
  QUOTE_STAGE_MESSAGE,
  QUOTE_STATUS_MESSAGE,
  QuoteStage,
  QuoteStatus,
  isIsoDateOnly,
  isQuoteStage,
  isQuoteStatus,
  stageOfStatus,
} from './quote.constants';
import { quoteSearchWhere } from './quote-search';

/** Cotización tal como la consume el frontend (`Quote`). */
export interface QuoteResponse {
  id: number;
  clientId: number | null;
  clientName: string;
  description: string;
  stage: QuoteStage;
  status: QuoteStatus;
  comment: string | null;
  /** `YYYY-MM-DD`, o null = prioridad normal. */
  priorityDate: string | null;
  /** ISO 8601, o null mientras está por enviar. */
  sentAt: string | null;
  orderId: number | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
  createdBy: { id: number; name: string } | null;
}

export const QUOTE_SELECT = {
  id: true,
  clientId: true,
  clientName: true,
  description: true,
  stage: true,
  status: true,
  comment: true,
  priorityDate: true,
  sentAt: true,
  orderId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: MOCKUP_AUTHOR_SELECT,
} satisfies Prisma.QuoteSelect;

type QuoteRow = Prisma.QuoteGetPayload<{ select: typeof QUOTE_SELECT }>;

/**
 * Orden del tablero: primero las que tienen fecha de prioridad, de la más
 * vieja a la más nueva (atrasadas, hoy, mañana…); después las de prioridad
 * normal. Dentro de cada grupo, lo último que se movió arriba.
 */
export const QUOTE_ORDER_BY: Prisma.QuoteOrderByWithRelationInput[] = [
  { priorityDate: { sort: 'asc', nulls: 'last' } },
  { updatedAt: 'desc' },
  { id: 'desc' },
];

const notFound = () =>
  new HttpException('Cotización no encontrada', HttpStatus.NOT_FOUND);

const badRequest = (message: string) =>
  new HttpException(message, HttpStatus.BAD_REQUEST);

/**
 * Cotizaciones de Recepción (`/quotes`). Los roles los fija el controller;
 * acá se repiten las validaciones del DTO porque el service también se usa
 * sin el ValidationPipe (y `POST /quotes/bulk` valida cada ítem con su
 * número para que el mensaje diga cuál falló).
 */
@Injectable()
export class QuoteService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista filtrada por etapa, subestado y búsqueda libre. */
  async findAll(query: ListQuotesQueryDto = {}): Promise<QuoteResponse[]> {
    const where: Prisma.QuoteWhereInput = {};
    const stage = query.stage ?? undefined;
    const status = query.status ?? undefined;
    if (stage !== undefined) {
      if (!isQuoteStage(stage)) throw badRequest(QUOTE_STAGE_MESSAGE);
      where.stage = stage;
    }
    if (status !== undefined) {
      if (!isQuoteStatus(status)) throw badRequest(QUOTE_STATUS_MESSAGE);
      if (stage !== undefined && stageOfStatus(status) !== stage) {
        throw badRequest(statusMismatchMessage(stage, status));
      }
      where.status = status;
    }
    if (query.q !== undefined && query.q !== null) {
      assertNoNul(query.q);
      const search = quoteSearchWhere(String(query.q));
      if (search) where.AND = [search];
    }

    const rows = await this.prisma.quote.findMany({
      where,
      select: QUOTE_SELECT,
      orderBy: QUOTE_ORDER_BY,
    });
    return rows.map(toResponse);
  }

  /** Alta de una cotización. */
  async create(dto: CreateQuoteDto, userId: number): Promise<QuoteResponse> {
    const [data] = await this.prepareCreate([dto], userId, false);
    const row = await this.prisma.quote.create({ data, select: QUOTE_SELECT });
    return toResponse(row);
  }

  /**
   * Alta en bloque ("pegar lista" de WhatsApp): 1 a 100 cotizaciones, todas
   * o ninguna (una sola transacción). Devuelve las creadas en el mismo
   * orden en que llegaron.
   */
  async createBulk(
    dto: BulkCreateQuotesDto,
    userId: number,
  ): Promise<QuoteResponse[]> {
    const items = dto?.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw badRequest('Agrega al menos una cotización');
    }
    if (items.length > MAX_QUOTE_BULK_ITEMS) {
      throw badRequest(
        `No se pueden cargar más de ${MAX_QUOTE_BULK_ITEMS} cotizaciones a la vez`,
      );
    }
    const data = await this.prepareCreate(items, userId, true);
    const rows = await this.prisma.$transaction(
      data.map((item) =>
        this.prisma.quote.create({ data: item, select: QUOTE_SELECT }),
      ),
    );
    return rows.map(toResponse);
  }

  /**
   * Edita cualquier campo. Etapa/subestado: con sólo la etapa (distinta de
   * la actual) toma el subestado por defecto de esa etapa; con sólo el
   * subestado, pasa a la etapa de ese subestado. Al pasar a `enviada` se
   * fija `sentAt` (si no tenía); al volver a `por_enviar` se limpia.
   */
  async update(id: number, dto: UpdateQuoteDto): Promise<QuoteResponse> {
    const current = await this.prisma.quote.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        clientName: true,
        stage: true,
        status: true,
        sentAt: true,
      },
    });
    if (!current) throw notFound();

    const data: Prisma.QuoteUncheckedUpdateInput = {};

    // Cliente registrado y nombre mostrado.
    let clientId = current.clientId;
    let resolvedClientName: string | undefined;
    if (dto.clientId !== undefined) {
      if (dto.clientId === null) {
        clientId = null;
      } else {
        clientId = assertClientId(dto.clientId, '');
        const names = await this.resolveClientNames([clientId], '');
        resolvedClientName = names.get(clientId);
      }
      data.clientId = clientId;
    }
    if (dto.clientName !== undefined) {
      const name = assertClientNameShape(dto.clientName, '');
      if (name) {
        data.clientName = name;
      } else if (clientId !== null) {
        data.clientName =
          resolvedClientName ??
          (await this.resolveClientNames([clientId], '')).get(clientId);
      } else {
        throw badRequest(QUOTE_CLIENT_NAME_MESSAGE);
      }
    } else if (
      resolvedClientName !== undefined &&
      clientId !== current.clientId
    ) {
      // Cambió de cliente sin mandar nombre: mostrar el del nuevo cliente.
      data.clientName = resolvedClientName;
    }

    if (dto.description !== undefined) {
      data.description = assertDescription(dto.description, '');
    }

    if (dto.stage !== undefined || dto.status !== undefined) {
      const next = resolveStageStatus(dto.stage, dto.status, '', {
        stage: current.stage as QuoteStage,
        status: current.status as QuoteStatus,
      });
      data.stage = next.stage;
      data.status = next.status;
      if (next.stage === 'enviada' && !current.sentAt) {
        data.sentAt = new Date();
      } else if (next.stage === 'por_enviar') {
        data.sentAt = null;
      }
    }

    if (dto.priorityDate !== undefined) {
      data.priorityDate = parsePriorityDate(dto.priorityDate, '');
    }
    if (dto.comment !== undefined) {
      data.comment = parseComment(dto.comment, '');
    }

    try {
      const row = await this.prisma.quote.update({
        where: { id },
        data,
        select: QUOTE_SELECT,
      });
      return toResponse(row);
    } catch (error) {
      if (error?.code === 'P2025') throw notFound();
      throw error;
    }
  }

  /**
   * Liga el pedido en que se convirtió una cotización aceptada. 400 si no
   * está aceptada, 404 si la cotización o el pedido no existen, 409 si el
   * pedido ya está ligado a OTRA cotización. Volver a ligar el mismo pedido
   * es idempotente.
   */
  async linkOrder(id: number, orderId: number): Promise<QuoteResponse> {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!quote) throw notFound();
    if (quote.status !== QUOTE_ACCEPTED_STATUS) {
      throw badRequest(
        'Sólo se puede ligar un pedido a una cotización aceptada',
      );
    }
    if (!Number.isInteger(orderId) || orderId <= 0) {
      throw badRequest('El pedido debe ser un id numérico válido');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true },
    });
    if (!order) {
      throw new HttpException(
        `El pedido #${orderId} no existe`,
        HttpStatus.NOT_FOUND,
      );
    }
    const linked = await this.prisma.quote.findUnique({
      where: { orderId },
      select: { id: true },
    });
    if (linked && linked.id !== id) throw orderAlreadyLinked(orderId);

    try {
      const row = await this.prisma.quote.update({
        where: { id },
        data: { orderId },
        select: QUOTE_SELECT,
      });
      return toResponse(row);
    } catch (error) {
      // Carrera: otra cotización tomó el pedido entre la consulta y el update.
      if (error?.code === 'P2002') throw orderAlreadyLinked(orderId);
      if (error?.code === 'P2025') throw notFound();
      throw error;
    }
  }

  /** Borra una cotización (404 si no existe). El pedido ligado no se toca. */
  async remove(id: number): Promise<void> {
    const { count } = await this.prisma.quote.deleteMany({ where: { id } });
    if (count === 0) throw notFound();
  }

  /**
   * Valida y normaliza los ítems de un alta (simple o en bloque) y resuelve
   * los clientes registrados con UNA consulta. En bloque, cada mensaje de
   * error empieza con "Cotización N: ".
   */
  private async prepareCreate(
    items: CreateQuoteDto[],
    userId: number,
    bulk: boolean,
  ): Promise<Prisma.QuoteUncheckedCreateInput[]> {
    const prefixOf = (index: number) =>
      bulk ? `Cotización ${index + 1}: ` : '';

    const clientIds = items.map((item, index) =>
      item?.clientId === undefined || item?.clientId === null
        ? null
        : assertClientId(item.clientId, prefixOf(index)),
    );
    const firstIndexOf = new Map<number, number>();
    clientIds.forEach((clientId, index) => {
      if (clientId !== null && !firstIndexOf.has(clientId)) {
        firstIndexOf.set(clientId, index);
      }
    });
    const clientNames = await this.resolveClientNames(
      [...firstIndexOf.keys()],
      (clientId) => prefixOf(firstIndexOf.get(clientId) ?? 0),
    );

    const now = new Date();
    return items.map((item, index) => {
      const prefix = prefixOf(index);
      if (!item || typeof item !== 'object') {
        throw badRequest(`${prefix}${QUOTE_DESCRIPTION_MESSAGE}`);
      }
      const clientId = clientIds[index];
      const typedName =
        item.clientName === undefined || item.clientName === null
          ? ''
          : assertClientNameShape(item.clientName, prefix);
      const clientName =
        typedName || (clientId !== null ? clientNames.get(clientId) : '');
      if (!clientName) {
        throw badRequest(`${prefix}${QUOTE_CLIENT_NAME_MESSAGE}`);
      }
      const { stage, status } = resolveStageStatus(
        item.stage ?? undefined,
        item.status ?? undefined,
        prefix,
      );
      return {
        clientId,
        clientName,
        description: assertDescription(item.description, prefix),
        stage,
        status,
        comment:
          item.comment === undefined
            ? null
            : parseComment(item.comment, prefix),
        priorityDate:
          item.priorityDate === undefined
            ? null
            : parsePriorityDate(item.priorityDate, prefix),
        sentAt: stage === 'enviada' ? now : null,
        createdById: userId,
      };
    });
  }

  /**
   * Nombre a mostrar de cada cliente (`first_name last_name`). 404 si alguno
   * no existe.
   */
  private async resolveClientNames(
    clientIds: number[],
    prefix: string | ((clientId: number) => string),
  ): Promise<Map<number, string>> {
    const names = new Map<number, string>();
    if (clientIds.length === 0) return names;
    const clients = await this.prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, first_name: true, last_name: true },
    });
    for (const client of clients) {
      names.set(
        client.id,
        [client.first_name, client.last_name]
          .map((part) => part?.trim())
          .filter(Boolean)
          .join(' ')
          .slice(0, MAX_QUOTE_CLIENT_NAME_LENGTH),
      );
    }
    for (const clientId of clientIds) {
      if (!names.has(clientId)) {
        const p = typeof prefix === 'function' ? prefix(clientId) : prefix;
        throw new HttpException(
          `${p}El cliente #${clientId} no existe`,
          HttpStatus.NOT_FOUND,
        );
      }
    }
    return names;
  }
}

function toResponse(row: QuoteRow): QuoteResponse {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    description: row.description,
    stage: row.stage as QuoteStage,
    status: row.status as QuoteStatus,
    comment: row.comment,
    priorityDate: row.priorityDate
      ? row.priorityDate.toISOString().slice(0, 10)
      : null,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    orderId: row.orderId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: mockupAuthor(row.createdBy),
  };
}

function orderAlreadyLinked(orderId: number) {
  return new HttpException(
    `El pedido #${orderId} ya está ligado a otra cotización`,
    HttpStatus.CONFLICT,
  );
}

function statusMismatchMessage(stage: QuoteStage, status: QuoteStatus) {
  return `El subestado "${status}" no corresponde a la etapa "${stage}"`;
}

function assertNoNul(value: unknown, prefix = ''): void {
  if (typeof value === 'string' && value.includes('\u0000')) {
    throw badRequest(`${prefix}${QUOTE_NUL_MESSAGE}`);
  }
}

function assertClientId(value: unknown, prefix: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw badRequest(`${prefix}El cliente debe ser un id numérico válido`);
  }
  return value;
}

/** Nombre escrito, sin espacios de más. Puede quedar vacío (lo decide el caller). */
function assertClientNameShape(value: unknown, prefix: string): string {
  if (typeof value !== 'string') {
    throw badRequest(`${prefix}${QUOTE_CLIENT_NAME_MESSAGE}`);
  }
  assertNoNul(value, prefix);
  const name = value.trim();
  if (name.length > MAX_QUOTE_CLIENT_NAME_LENGTH) {
    throw badRequest(`${prefix}${QUOTE_CLIENT_NAME_MESSAGE}`);
  }
  return name;
}

function assertDescription(value: unknown, prefix: string): string {
  if (typeof value !== 'string') {
    throw badRequest(`${prefix}${QUOTE_DESCRIPTION_MESSAGE}`);
  }
  assertNoNul(value, prefix);
  const description = value.trim();
  if (!description || description.length > MAX_QUOTE_DESCRIPTION_LENGTH) {
    throw badRequest(`${prefix}${QUOTE_DESCRIPTION_MESSAGE}`);
  }
  return description;
}

/** null o vacío = sin comentario. */
function parseComment(value: unknown, prefix: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw badRequest(`${prefix}${QUOTE_COMMENT_MESSAGE}`);
  }
  assertNoNul(value, prefix);
  const comment = value.trim();
  if (comment.length > MAX_QUOTE_COMMENT_LENGTH) {
    throw badRequest(`${prefix}${QUOTE_COMMENT_MESSAGE}`);
  }
  return comment || null;
}

/** `YYYY-MM-DD` → medianoche UTC (columna DATE); null = prioridad normal. */
function parsePriorityDate(value: unknown, prefix: string): Date | null {
  if (value === null) return null;
  if (!isIsoDateOnly(value)) {
    throw badRequest(`${prefix}${QUOTE_PRIORITY_DATE_MESSAGE}`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Etapa y subestado resultantes. Sin ninguno: los actuales (o
 * `por_enviar`/`lista` en un alta). Sólo etapa: si es la actual se conserva
 * el subestado; si no, el subestado por defecto de la etapa. Sólo
 * subestado: la etapa a la que pertenece. Ambos: tienen que coincidir.
 */
export function resolveStageStatus(
  stageInput: unknown,
  statusInput: unknown,
  prefix: string,
  current?: { stage: QuoteStage; status: QuoteStatus },
): { stage: QuoteStage; status: QuoteStatus } {
  if (stageInput !== undefined && !isQuoteStage(stageInput)) {
    throw badRequest(`${prefix}${QUOTE_STAGE_MESSAGE}`);
  }
  if (statusInput !== undefined && !isQuoteStatus(statusInput)) {
    throw badRequest(`${prefix}${QUOTE_STATUS_MESSAGE}`);
  }
  const stage = stageInput as QuoteStage | undefined;
  const status = statusInput as QuoteStatus | undefined;
  if (stage === undefined && status === undefined) {
    return (
      current ?? {
        stage: 'por_enviar',
        status: DEFAULT_QUOTE_STATUS.por_enviar,
      }
    );
  }
  if (status === undefined) {
    return current && current.stage === stage
      ? current
      : { stage, status: DEFAULT_QUOTE_STATUS[stage] };
  }
  if (stage === undefined) {
    return { stage: stageOfStatus(status), status };
  }
  if (stageOfStatus(status) !== stage) {
    throw badRequest(`${prefix}${statusMismatchMessage(stage, status)}`);
  }
  return { stage, status };
}
