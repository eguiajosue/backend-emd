import { applyDecorators, UseGuards } from '@nestjs/common';
import { Roles } from './roles.decorator';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Role } from '../enums/roles.enum';

export function Auth(...roles: Role[]) {
  return applyDecorators(Roles(...roles), UseGuards(AuthGuard, RolesGuard));
}
