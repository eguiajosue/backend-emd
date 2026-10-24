import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import {
  satisfiesAccess,
  type Access,
} from 'src/common/enums/area-access.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Access[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      return true;
    }

    // `user` ya viene normalizado por AuthGuard (roles + áreas).
    const { user } = context.switchToHttp().getRequest();
    const allowed = satisfiesAccess(user, required);
    if (!allowed) {
      // Devolver false haría que Nest lance un ForbiddenException genérico con
      // el mensaje en inglés "Forbidden resource", que el frontend muestra tal
      // cual al usuario. Lanzamos un mensaje propio, en español.
      throw new ForbiddenException('Sin permisos para acceder a esta sección');
    }

    return true;
  }
}
