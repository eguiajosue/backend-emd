import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Loguea cada request HTTP con su request id, método, ruta, status y duración.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { id?: string }>();
    const response = http.getResponse<Response>();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.log(request, response.statusCode, start),
        error: () => this.log(request, response.statusCode, start),
      }),
    );
  }

  private log(
    request: Request & { id?: string },
    statusCode: number,
    start: number,
  ) {
    const duration = Date.now() - start;
    this.logger.log(
      `[${request.id ?? '-'}] ${request.method} ${request.originalUrl} ${statusCode} ${duration}ms`,
    );
  }
}
