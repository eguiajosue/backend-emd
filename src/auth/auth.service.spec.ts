import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcryptjs from 'bcryptjs';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';

describe('AuthService', () => {
  let authService: AuthService;
  let userService: jest.Mocked<UserService>;
  let jwtService: jest.Mocked<JwtService>;
  let configService: ConfigService;

  const mockUser = {
    id: 1,
    username: 'admin',
    password: '',
    firstName: 'Admin',
    lastName: 'User',
    roles: [{ id: 1, name: 'admin' }],
  };

  beforeAll(async () => {
    mockUser.password = await bcryptjs.hash('correct-password', 10);
  });

  beforeEach(() => {
    userService = {
      findOneByUsername: jest.fn(),
    } as unknown as jest.Mocked<UserService>;

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-jwt-token'),
      verifyAsync: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    configService = {
      get: jest.fn((key: string) =>
        key === 'JWT_REFRESH_EXPIRES_IN'
          ? '7d'
          : 'a-very-long-test-secret-value-0123456789',
      ),
    } as unknown as ConfigService;

    authService = new AuthService(userService, jwtService, configService);
  });

  describe('login', () => {
    it('should return a token and user info on successful login', async () => {
      userService.findOneByUsername.mockResolvedValue(mockUser as any);

      const result = await authService.login({
        username: 'admin',
        password: 'correct-password',
      });

      expect(userService.findOneByUsername).toHaveBeenCalledWith('admin');
      expect(jwtService.signAsync).toHaveBeenNthCalledWith(1, {
        username: mockUser.username,
        sub: mockUser.id,
        roles: ['admin'],
      });
      // El segundo token firmado es el refresh (marcado con type: 'refresh').
      expect(jwtService.signAsync).toHaveBeenNthCalledWith(
        2,
        {
          username: mockUser.username,
          sub: mockUser.id,
          roles: ['admin'],
          type: 'refresh',
        },
        expect.objectContaining({ expiresIn: '7d' }),
      );
      expect(result).toEqual({
        token: 'signed-jwt-token',
        refreshToken: 'signed-jwt-token',
        username: mockUser.username,
        first_name: mockUser.firstName,
        last_name: mockUser.lastName,
        roles: ['admin'],
      });
    });

    it('should throw an HttpException when the user does not exist', async () => {
      userService.findOneByUsername.mockResolvedValue(null);

      await expect(
        authService.login({ username: 'unknown', password: 'whatever' }),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });

    it('should throw an HttpException when the password is incorrect', async () => {
      userService.findOneByUsername.mockResolvedValue(mockUser as any);

      await expect(
        authService.login({ username: 'admin', password: 'wrong-password' }),
      ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('should issue a new token pair for a valid refresh token', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        username: 'admin',
        sub: 1,
        roles: ['admin'],
        type: 'refresh',
      });
      userService.findOneByUsername.mockResolvedValue(mockUser as any);

      const result = await authService.refresh({ refreshToken: 'valid-token' });

      expect(result).toEqual({
        token: 'signed-jwt-token',
        refreshToken: 'signed-jwt-token',
        username: mockUser.username,
        first_name: mockUser.firstName,
        last_name: mockUser.lastName,
        roles: ['admin'],
      });
    });

    it('should reject an access token used as a refresh token', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        username: 'admin',
        sub: 1,
        roles: ['admin'],
      });

      await expect(
        authService.refresh({ refreshToken: 'access-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject an invalid or expired refresh token', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('expired'));

      await expect(
        authService.refresh({ refreshToken: 'expired-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
