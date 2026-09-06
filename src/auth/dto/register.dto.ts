import { CreateUserDto } from 'src/user/dto/create-user.dto';

/**
 * El username lo genera GenerateUsernameMiddleware a partir de firstName y
 * lastName antes de llegar al controller, así que RegisterDto hereda de
 * CreateUserDto (misma política de contraseña y mismos límites).
 */
export class RegisterDto extends CreateUserDto {}
