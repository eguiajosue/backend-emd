import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
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
    guard = new AuthGuard(jwtService);
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

  it('should allow access with a valid token', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 1, username: 'admin' });

    await expect(
      guard.canActivate(createContext('Bearer good-token')),
    ).resolves.toBe(true);
  });
});
