import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/**
 * Paginación OPT-IN: si el cliente no manda `page` ni `limit`, los endpoints
 * siguen devolviendo el array plano de siempre (contrato actual del frontend).
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: DEFAULT_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_LIMIT,
    default: DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface ResolvedPagination {
  enabled: boolean;
  page: number;
  limit: number;
  skip: number;
}

export function resolvePagination(
  query?: PaginationQueryDto,
): ResolvedPagination {
  const enabled = Boolean(query && (query.page || query.limit));
  const page = query?.page && query.page > 0 ? query.page : DEFAULT_PAGE;
  const rawLimit =
    query?.limit && query.limit > 0 ? query.limit : DEFAULT_LIMIT;
  const limit = Math.min(rawLimit, MAX_LIMIT);

  return { enabled, page, limit, skip: (page - 1) * limit };
}

export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
    },
  };
}
