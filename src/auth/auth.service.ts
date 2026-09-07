import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcryptjs from 'bcryptjs';
import { UserService } from 'src/user/user.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

export interface AccessTokenPayload {
  username: string;
  sub: number;
  roles: string[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService?: ConfigService,
  ) {}

  private get refreshSecret(): string | undefined {
    return (
      this.configService?.get<string>('JWT_REFRESH_SECRET') ??
      this.configService?.get<string>('JWT_SECRET')
    );
  }

  private get refreshExpiresIn(): string {
    return this.configService?.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
  }

  private async signTokens(payload: AccessTokenPayload) {
    const token = await this.jwtService.signAsync(payload);
    const refreshToken = await this.jwtService.signAsync(
      { ...payload, type: 'refresh' },
      {
        ...(this.refreshSecret ? { secret: this.refreshSecret } : {}),
        expiresIn: this.refreshExpiresIn,
      },
    );
    return { token, refreshToken };
  }

  async login(loginDto: LoginDto) {
    const user = await this.userService.findOneByUsername(loginDto.username);

    if (!user) {
      this.logger.warn(
        `Intento de login fallido: usuario inexistente "${loginDto.username}"`,
      );
      throw new HttpException('Usuario no encontrado', HttpStatus.NOT_FOUND);
    }

    const isValidPassword = await bcryptjs.compare(
      loginDto.password,
      user.password,
    );

    if (!isValidPassword) {
      this.logger.warn(
        `Intento de login fallido: contraseña incorrecta para "${loginDto.username}"`,
      );
      throw new HttpException(
        'Credenciales incorrectas',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const roleNames = user.roles.map((role) => role.name);

    const { token, refreshToken } = await this.signTokens({
      username: user.username,
      sub: user.id,
      roles: roleNames,
    });

    return {
      token,
      refreshToken,
      id: user.id,
      username: user.username,
      first_name: user.firstName,
      last_name: user.lastName,
      roles: roleNames,
    };
  }

  /**
   * Canjea un refresh token válido por un nuevo par de tokens.
   * Los roles se releen de la base, así un cambio de permisos se aplica
   * en el siguiente refresh en vez de esperar a que expire el token largo.
   */
  async refresh({ refreshToken }: RefreshTokenDto) {
    let payload: AccessTokenPayload & { type?: string };

    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        ...(this.refreshSecret ? { secret: this.refreshSecret } : {}),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Token provisto no es un refresh token');
    }

    const user = await this.userService.findOneByUsername(payload.username);
    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    const roleNames = user.roles.map((role) => role.name);
    const tokens = await this.signTokens({
      username: user.username,
      sub: user.id,
      roles: roleNames,
    });

    return {
      // Mismo shape que `login`: sin `id`, un cliente que se apoye en la
      // respuesta del refresh se queda sin saber quién es la sesión.
      id: user.id,
      ...tokens,
      username: user.username,
      first_name: user.firstName,
      last_name: user.lastName,
      roles: roleNames,
    };
  }

  async register(registerDto: RegisterDto) {
    const user = await this.userService.findOneByUsername(registerDto.username);

    if (user) {
      throw new HttpException('El usuario ya existe', HttpStatus.CONFLICT);
    }

    return await this.userService.create(registerDto);
  }

  async profile(user: { username: string }) {
    const userData = await this.userService.findOneByUsername(user.username);
    if (!userData) {
      return null;
    }
    // Nunca exponer el hash de la contraseña.
    const safeUser: Partial<typeof userData> = { ...userData };
    delete safeUser.password;
    return safeUser;
  }
}
