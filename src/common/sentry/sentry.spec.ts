import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import {
  buildSentryOptions,
  parseTracesSampleRate,
  scrubSentryEvent,
} from './sentry-options';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

describe('Sentry', () => {
  describe('buildSentryOptions', () => {
    it('sin SENTRY_DSN queda apagado (null)', () => {
      expect(buildSentryOptions({})).toBeNull();
      expect(buildSentryOptions({ SENTRY_DSN: '  ' })).toBeNull();
    });

    it('environment de SENTRY_ENVIRONMENT, o NODE_ENV; traces en 0 por defecto', () => {
      const dsn = 'https://abc@o1.ingest.sentry.io/1';
      expect(
        buildSentryOptions({ SENTRY_DSN: dsn, NODE_ENV: 'production' }),
      ).toMatchObject({ dsn, environment: 'production', tracesSampleRate: 0 });
      expect(
        buildSentryOptions({
          SENTRY_DSN: dsn,
          NODE_ENV: 'production',
          SENTRY_ENVIRONMENT: 'staging',
          SENTRY_TRACES_SAMPLE_RATE: '0.2',
        }),
      ).toMatchObject({ environment: 'staging', tracesSampleRate: 0.2 });
    });

    it('no recolecta cuerpos, cookies ni usuario', () => {
      const options = buildSentryOptions({ SENTRY_DSN: 'https://k@x/1' })!;
      expect(options.dataCollection).toMatchObject({
        userInfo: false,
        cookies: false,
        httpBodies: [],
      });
      expect(typeof options.beforeSend).toBe('function');
    });

    it('parseTracesSampleRate ignora valores fuera de [0, 1]', () => {
      expect(parseTracesSampleRate(undefined)).toBe(0);
      expect(parseTracesSampleRate('1')).toBe(1);
      expect(parseTracesSampleRate('2')).toBe(0);
      expect(parseTracesSampleRate('abc')).toBe(0);
    });
  });

  describe('scrubSentryEvent', () => {
    it('quita cuerpo, cookies, headers de autenticación y datos del usuario', () => {
      const event: any = {
        request: {
          url: '/orders',
          data: '{"clientResourceFile":{"data":"..."}}',
          cookies: { refresh: 'x' },
          headers: {
            Authorization: 'Bearer secreto',
            cookie: 'a=b',
            'user-agent': 'jest',
          },
        },
        user: { id: 5, ip_address: '1.2.3.4', email: 'a@b.c' },
      };

      const scrubbed: any = scrubSentryEvent(event);

      expect(scrubbed.request).toEqual({
        url: '/orders',
        headers: { 'user-agent': 'jest' },
      });
      expect(scrubbed.user).toEqual({ id: 5 });
    });
  });

  describe('AllExceptionsFilter → Sentry', () => {
    const capture = Sentry.captureException as jest.Mock;
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          status: () => ({ json: jest.fn() }),
        }),
        getRequest: () => ({ url: '/x', method: 'GET', id: 'req-1' }),
      }),
    } as unknown as ArgumentsHost;

    beforeEach(() => {
      capture.mockClear();
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('reporta los errores no controlados (500)', () => {
      const error = new Error('boom');
      new AllExceptionsFilter(true).catch(error, host);
      expect(capture).toHaveBeenCalledWith(error, {
        tags: { requestId: 'req-1' },
        extra: { statusCode: 500 },
      });
    });

    it('reporta también una HttpException 5xx lanzada a propósito', () => {
      new AllExceptionsFilter(true).catch(
        new HttpException('x', HttpStatus.BAD_GATEWAY),
        host,
      );
      expect(capture).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['400', new BadRequestException('dato inválido')],
      ['403', new ForbiddenException()],
      [
        'P2025 → 404',
        new Prisma.PrismaClientKnownRequestError('x', {
          code: 'P2025',
          clientVersion: '5',
        }),
      ],
    ])('NO reporta errores esperados del cliente (%s)', (_label, error) => {
      new AllExceptionsFilter(true).catch(error, host);
      expect(capture).not.toHaveBeenCalled();
    });
  });
});
