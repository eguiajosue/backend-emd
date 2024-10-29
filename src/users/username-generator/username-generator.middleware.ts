// username-generation.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';

@Injectable()
export class UsernameGenerationMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const { first_name, last_name } = req.body;

    if (req.method.toUpperCase() === 'PATCH' && (first_name || last_name)) {
      const newFirstName = first_name || req.body.first_name_existing;
      const newLastName = last_name || req.body.last_name_existing;
      req.body.username = `${newFirstName.substring(0, 1).toLowerCase()}_${newLastName.toLowerCase()}`;
    } else if (req.method.toUpperCase() === 'POST' && !req.body.username) {
      req.body.username = `${first_name.substring(0, 1).toLowerCase()}_${last_name.toLowerCase()}`;
    }

    next();
  }
}
