import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let jwtService: jest.Mocked<JwtService>;

  const createContext = (authorization?: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization } }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jwtService = {
      verifyAsync: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;
    const configService = {
      get: jest.fn().mockReturnValue('test-secret'),
    } as unknown as ConfigService;
    guard = new AuthGuard(jwtService, configService);
  });

  it('should throw UnauthorizedException when no token is provided', async () => {
    await expect(guard.canActivate(createContext())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException when the token is invalid', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));

    await expect(
      guard.canActivate(createContext('Bearer bad-token')),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should reject a refresh token used as an access token', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 1,
      username: 'admin',
      type: 'refresh',
    });

    await expect(
      guard.canActivate(createContext('Bearer refresh-token')),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should allow access with a valid token', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 1, username: 'admin' });

    await expect(
      guard.canActivate(createContext('Bearer good-token')),
    ).resolves.toBe(true);
  });
});
