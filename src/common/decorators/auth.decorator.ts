import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Roles } from './roles.decorator';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import type { Access } from '../enums/area-access.enum';

export function Auth(...access: Access[]) {
  return applyDecorators(
    Roles(...access),
    UseGuards(AuthGuard, RolesGuard),
    ApiBearerAuth(),
    ApiUnauthorizedResponse({
      description: 'Token ausente, inválido o expirado',
    }),
  );
}
