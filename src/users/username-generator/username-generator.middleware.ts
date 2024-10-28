import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response } from 'express';

@Injectable()
export class UsernameGenerationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: () => void) {
    const { username, first_name, last_name } = req.body;

    if (!username && first_name && last_name) {
      req.body.username = `${first_name.substring(0, 1).toLowerCase()}_${last_name.toLowerCase()}`;
    }

    next();
  }
}
