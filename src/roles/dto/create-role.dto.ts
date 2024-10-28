import { IsEnum } from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateRoleDto {
  @IsEnum(UserRole, {
    message:
      'El rol a utilziar debe de ser unicamente: SUPERVISOR, WORKSHOP, RECEPTIONIST',
  })
  role_name: UserRole;
}
