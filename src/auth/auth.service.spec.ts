import { HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcryptjs from 'bcryptjs';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';

describe('AuthService', () => {
  let authService: AuthService;
  let userService: jest.Mocked<UserService>;
  let jwtService: jest.Mocked<JwtService>;

  const mockUser = {
    id: 1,
    username: 'admin',
    password: '',
    firstName: 'Admin',
    lastName: 'User',
    role: { id: 1, name: 'admin' },
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
    } as unknown as jest.Mocked<JwtService>;

    authService = new AuthService(userService, jwtService);
  });

  describe('login', () => {
    it('should return a token and user info on successful login', async () => {
      userService.findOneByUsername.mockResolvedValue(mockUser as any);

      const result = await authService.login({
        username: 'admin',
        password: 'correct-password',
      });

      expect(userService.findOneByUsername).toHaveBeenCalledWith('admin');
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        username: mockUser.username,
        sub: mockUser.id,
        role: mockUser.role,
      });
      expect(result).toEqual({
        token: 'signed-jwt-token',
        username: mockUser.username,
        first_name: mockUser.firstName,
        last_name: mockUser.lastName,
        role: mockUser.role.name,
      });
    });

    it('should return an HttpException when the user does not exist', async () => {
      userService.findOneByUsername.mockResolvedValue(null);

      const result = await authService.login({
        username: 'unknown',
        password: 'whatever',
      });

      expect(result).toBeInstanceOf(HttpException);
      expect((result as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    });

    it('should return an HttpException when the password is incorrect', async () => {
      userService.findOneByUsername.mockResolvedValue(mockUser as any);

      const result = await authService.login({
        username: 'admin',
        password: 'wrong-password',
      });

      expect(result).toBeInstanceOf(HttpException);
      expect((result as HttpException).getStatus()).toBe(
        HttpStatus.UNAUTHORIZED,
      );
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });
  });
});
