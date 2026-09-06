import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

export interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
  requestId?: string;
}

/**
 * Filtro global de excepciones.
 *
 * Normaliza TODAS las respuestas de error al mismo shape y evita filtrar
 * stack traces o detalles internos de Prisma al cliente en producción.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsFilter');

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, message, error } = this.normalize(exception);

    const body: ErrorResponseBody = {
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request?.url ?? '',
    };

    const requestId = (request as Request & { id?: string })?.id;
    if (requestId) {
      body.requestId = requestId;
    }

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request?.method} ${request?.url} -> ${statusCode}${
          requestId ? ` [${requestId}]` : ''
        }`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request?.method} ${request?.url} -> ${statusCode}: ${
          Array.isArray(message) ? message.join('; ') : message
        }`,
      );
    }

    response.status(statusCode).json(body);
  }

  private normalize(exception: unknown): {
    statusCode: number;
    message: string | string[];
    error: string;
  } {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return {
          statusCode,
          message: payload,
          error: this.errorName(statusCode),
        };
      }

      const record = payload as Record<string, unknown>;
      return {
        statusCode,
        message:
          (record.message as string | string[]) ?? exception.message ?? '',
        error: (record.error as string) ?? this.errorName(statusCode),
      };
    }

    const prismaMapped = this.mapPrismaError(exception);
    if (prismaMapped) {
      return prismaMapped;
    }

    // Error desconocido: nunca exponer el mensaje interno en producción.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: this.isProduction
        ? 'Error interno del servidor'
        : exception instanceof Error
          ? exception.message
          : 'Error interno del servidor',
      error: 'Internal Server Error',
    };
  }

  private mapPrismaError(exception: unknown): {
    statusCode: number;
    message: string;
    error: string;
  } | null {
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Datos inválidos para la operación solicitada',
        error: 'Bad Request',
      };
    }

    if (!(exception instanceof Prisma.PrismaClientKnownRequestError)) {
      return null;
    }

    switch (exception.code) {
      case 'P2002':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'Ya existe un registro con esos datos únicos',
          error: 'Conflict',
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Registro no encontrado',
          error: 'Not Found',
        };
      case 'P2003':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Referencia inválida: el registro relacionado no existe',
          error: 'Bad Request',
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Error de base de datos',
          error: 'Internal Server Error',
        };
    }
  }

  private errorName(statusCode: number): string {
    return (
      Object.entries(HttpStatus)
        .find(([, value]) => value === statusCode)?.[0]
        ?.toLowerCase()
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ') ?? 'Error'
    );
  }
}
