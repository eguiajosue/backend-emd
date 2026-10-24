import { SetMetadata } from '@nestjs/common';
import type { Access } from 'src/common/enums/area-access.enum';

export const ROLES_KEY = 'roles';
export const Roles = (...access: Access[]) => SetMetadata(ROLES_KEY, access);
