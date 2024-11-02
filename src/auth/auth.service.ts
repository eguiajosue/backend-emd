import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcryptjs from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(private readonly userService: UserService) {}
  async login(loginDto: LoginDto) {
    const user = await this.userService.findOneByUsername(loginDto.username);

    if (!user) {
      return new HttpException('Usuario no encontrado', HttpStatus.NOT_FOUND);
    }

    const isValidPassword = await bcryptjs.compare(
      loginDto.password,
      user.password,
    );

    if (!isValidPassword) {
      return new HttpException(
        'Credenciales incorrectas',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return user.username + ' ha iniciado sesión';
  }

  async register(registerDto: RegisterDto) {
    const user = await this.userService.findOneByUsername(registerDto.username);

    if (user) {
      return new HttpException('El usuario ya existe', HttpStatus.CONFLICT);
    }

    return await this.userService.create(registerDto);
  }
}
