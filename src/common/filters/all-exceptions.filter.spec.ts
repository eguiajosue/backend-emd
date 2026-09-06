import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  const createHost = () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/orders', method: 'GET', id: 'req-1' }),
      }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  };

  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('db error', {
      code,
      clientVersion: '5.21.1',
    });

  it('normalizes HttpException to the shared error shape', () => {
    const { host, status, json } = createHost();
    new AllExceptionsFilter(true).catch(
      new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND),
      host,
    );

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: 'Orden no encontrada',
        error: 'Not Found',
        path: '/orders',
        requestId: 'req-1',
      }),
    );
    expect(json.mock.calls[0][0].timestamp).toEqual(expect.any(String));
  });

  it('maps Prisma P2002 to 409 Conflict', () => {
    const { host, status, json } = createHost();
    new AllExceptionsFilter(true).catch(prismaError('P2002'), host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json.mock.calls[0][0].error).toBe('Conflict');
  });

  it('maps Prisma P2025 to 404 Not Found', () => {
    const { host, status } = createHost();
    new AllExceptionsFilter(true).catch(prismaError('P2025'), host);

    expect(status).toHaveBeenCalledWith(404);
  });

  it('hides internal error details in production', () => {
    const { host, status, json } = createHost();
    new AllExceptionsFilter(true).catch(
      new Error('connect ECONNREFUSED 10.0.0.1:5432'),
      host,
    );

    expect(status).toHaveBeenCalledWith(500);
    expect(json.mock.calls[0][0].message).toBe('Error interno del servidor');
  });

  it('keeps the original message outside production', () => {
    const { host, json } = createHost();
    new AllExceptionsFilter(false).catch(new Error('boom'), host);

    expect(json.mock.calls[0][0].message).toBe('boom');
  });
});
