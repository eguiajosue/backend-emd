/**
 *   user_id    String  @id @default(cuid())
  role_id    String
  first_name String
  last_name  String?
  username   String  @unique
  password   String

  Role   Roles    @relation(fields: [role_id], references: [role_id])
  Orders Orders[]
  Logs   Logs[]
 */

import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  role_id: string;

  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  @IsString()
  @IsOptional()
  username: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;
}
