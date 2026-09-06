import {
  buildPaginatedResult,
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
  resolvePagination,
} from './pagination-query.dto';

describe('resolvePagination', () => {
  it('is disabled when no pagination query params are sent (contrato actual)', () => {
    expect(resolvePagination().enabled).toBe(false);
    expect(resolvePagination({}).enabled).toBe(false);
  });

  it('is enabled when page or limit is present', () => {
    expect(resolvePagination({ page: 2 })).toEqual({
      enabled: true,
      page: 2,
      limit: DEFAULT_LIMIT,
      skip: DEFAULT_LIMIT,
    });
    expect(resolvePagination({ limit: 10 })).toEqual({
      enabled: true,
      page: DEFAULT_PAGE,
      limit: 10,
      skip: 0,
    });
  });

  it('caps limit at MAX_LIMIT', () => {
    expect(resolvePagination({ limit: 5000 }).limit).toBe(MAX_LIMIT);
  });
});

describe('buildPaginatedResult', () => {
  it('returns data plus meta', () => {
    expect(buildPaginatedResult([{ id: 1 }], 101, 2, 50)).toEqual({
      data: [{ id: 1 }],
      meta: { total: 101, page: 2, limit: 50, totalPages: 3 },
    });
  });
});
