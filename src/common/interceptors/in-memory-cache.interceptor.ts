import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * Cache en memoria (proceso único) con TTL para respuestas GET de catálogos
 * que casi nunca cambian (roles, estados). No usa Redis: para el volumen de
 * una PyME un `Map` in-process alcanza y no agrega infraestructura; si más
 * adelante se escala horizontalmente, se puede migrar a un store distribuido
 * sin cambiar la forma de uso del decorador `@CacheTtl`.
 *
 * Se invalida sola por TTL; no hay invalidación activa en create/update/delete
 * porque estos catálogos cambian con tan poca frecuencia que un TTL corto
 * (por defecto 5 minutos) es suficiente y mucho más simple.
 */
const cacheStore = new Map<string, CacheEntry>();

export const CACHE_TTL_METADATA = 'cache_ttl_ms';

/** Decorador de método: TTL en milisegundos para cachear la respuesta GET. */
export const CacheTtl = (ttlMs: number) =>
  Reflect.metadata(CACHE_TTL_METADATA, ttlMs);

@Injectable()
export class InMemoryCacheInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    if (request.method !== 'GET') {
      return next.handle();
    }

    const ttlMs: number | undefined = Reflect.getMetadata(
      CACHE_TTL_METADATA,
      context.getHandler(),
    );
    if (!ttlMs) {
      return next.handle();
    }

    const key = `${context.getClass().name}:${context.getHandler().name}:${request.originalUrl}`;
    const cached = cacheStore.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return of(cached.value);
    }

    return next.handle().pipe(
      tap((value) => {
        cacheStore.set(key, { value, expiresAt: Date.now() + ttlMs });
      }),
    );
  }
}
