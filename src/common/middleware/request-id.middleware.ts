import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Asigna (o propaga) un request id por petición. Con varias instancias detrás
 * de un balanceador es la única forma práctica de seguir una request end-to-end
 * en los logs.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();

    (req as Request & { id?: string }).id = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
