import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcryptjs from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

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

    const payload = {
      username: user.username,
      sub: user.id,
      role: user.role,
    };

    const token = await this.jwtService.signAsync(payload);

    return {
      token: token,
      username: user.username,
      first_name: user.firstName,
      last_name: user.lastName,
      role: user.role.name,
    };
  }

  async register(registerDto: RegisterDto) {
    const user = await this.userService.findOneByUsername(registerDto.username);

    if (user) {
      return new HttpException('El usuario ya existe', HttpStatus.CONFLICT);
    }

    return await this.userService.create(registerDto);
  }

  async profile(user) {
    const userData = await this.userService.findOneByUsername(user.username);
    return userData;
  }
}
