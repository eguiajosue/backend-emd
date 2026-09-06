import {
  Injectable,
  NestMiddleware,
  BadRequestException,
} from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { UserService } from '../user.service';

@Injectable()
export class GenerateUsernameMiddleware implements NestMiddleware {
  constructor(private userService: UserService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const { firstName, lastName, isSharedAccount } = req.body;

    // Cuenta compartida de área: el cliente manda su propio `username`
    // (ej. "taller") en vez de derivarlo de firstName+lastName.
    if (
      isSharedAccount === true &&
      typeof req.body.username === 'string' &&
      req.body.username.trim() !== ''
    ) {
      req.body.username = req.body.username.trim();
      return next();
    }

    if (!firstName || !lastName) {
      throw new BadRequestException(
        'firstName y lastName son requeridos para generar el username',
      );
    }

    const baseUsername = `${firstName[0].toLowerCase()}${lastName.toLowerCase()}`;
    let username = baseUsername;
    let counter = 1;

    // Chequear la disponibilidad del username en bucle hasta que esté disponible
    while (await this.userService.usernameExists(username)) {
      username = `${baseUsername}${counter}`;
      counter++;
    }

    req.body.username = username;
    next();
  }
}
