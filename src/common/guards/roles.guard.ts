import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    const userRoles: string[] = user?.roles ?? [];

    const allowed = requiredRoles.some((role) => userRoles.includes(role));
    if (!allowed) {
      // Devolver false haría que Nest lance un ForbiddenException genérico con
      // el mensaje en inglés "Forbidden resource", que el frontend muestra tal
      // cual al usuario. Lanzamos un mensaje propio, en español.
      throw new ForbiddenException('Sin permisos para acceder a esta sección');
    }

    return true;
  }
}
