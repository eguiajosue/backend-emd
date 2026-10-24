import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcryptjs from 'bcryptjs';
import { randomBytes } from 'crypto';
import { UserService } from 'src/user/user.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

/**
 * Hash bcrypt (mismo cost que user.service) de un valor aleatorio, sólo para
 * igualar el tiempo de login de usuarios inexistentes con el de existentes.
 */
const DUMMY_PASSWORD_HASH = bcryptjs.hashSync(
  randomBytes(16).toString('hex'),
  10,
);

export interface AccessTokenPayload {
  username: string;
  sub: number;
  roles: string[];
  /**
   * Slugs de las áreas ACTIVAS en las que trabaja (ver model Area). Separadas
   * de `roles`: el rol dice qué puede hacer, el área dónde trabaja.
   */
  areas: string[];
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

  private get refreshExpiresIn(): JwtSignOptions['expiresIn'] {
    return (
      this.configService?.get<JwtSignOptions['expiresIn']>(
        'JWT_REFRESH_EXPIRES_IN',
      ) ?? '7d'
    );
  }

  /** Roles y áreas activas de un usuario leído con `findOneByUsername`. */
  private accessOf(user: {
    roles: { name: string }[];
    areas?: { slug: string }[];
  }): Pick<AccessTokenPayload, 'roles' | 'areas'> {
    return {
      roles: user.roles.map((role) => role.name),
      areas: (user.areas ?? []).map((area) => area.slug),
    };
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

    // Siempre se corre bcrypt (contra un hash señuelo si el usuario no
    // existe) y se responde lo mismo: ni el status ni el tiempo de respuesta
    // deben revelar si un username existe.
    const isValidPassword = await bcryptjs.compare(
      loginDto.password,
      user?.password ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !isValidPassword) {
      this.logger.warn(
        user
          ? `Intento de login fallido: contraseña incorrecta para "${loginDto.username}"`
          : `Intento de login fallido: usuario inexistente "${loginDto.username}"`,
      );
      throw new HttpException(
        'Credenciales incorrectas',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const { roles, areas } = this.accessOf(user);

    const { token, refreshToken } = await this.signTokens({
      username: user.username,
      sub: user.id,
      roles,
      areas,
    });

    return {
      token,
      refreshToken,
      id: user.id,
      username: user.username,
      first_name: user.firstName,
      last_name: user.lastName,
      roles,
      areas,
    };
  }

  /**
   * Canjea un refresh token válido por un nuevo par de tokens.
   * Los roles y las áreas se releen de la base, así un cambio de permisos se aplica
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

    const { roles, areas } = this.accessOf(user);
    const tokens = await this.signTokens({
      username: user.username,
      sub: user.id,
      roles,
      areas,
    });

    return {
      // Mismo shape que `login`: sin `id`, un cliente que se apoye en la
      // respuesta del refresh se queda sin saber quién es la sesión.
      id: user.id,
      ...tokens,
      username: user.username,
      first_name: user.firstName,
      last_name: user.lastName,
      roles,
      areas,
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
