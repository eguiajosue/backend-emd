import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from '../enums/roles.enum';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  const createContext = (...roles: string[]): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: { roles } }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;
    guard = new RolesGuard(reflector);
  });

  it('should allow access when no roles are required', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(createContext(Role.ADMIN))).toBe(true);
  });

  it('should allow access when the user has one of the required roles', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);

    expect(guard.canActivate(createContext(Role.ADMIN))).toBe(true);
  });

  it('should deny access when the user does not have a required role', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);

    expect(() => guard.canActivate(createContext(Role.TALLER))).toThrow(
      ForbiddenException,
    );
  });

  it('nunca expone el mensaje crudo en inglés "Forbidden resource"', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);

    try {
      guard.canActivate(createContext(Role.TALLER));
      throw new Error('debería haber lanzado');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const message = (error as ForbiddenException).message;
      expect(message).not.toContain('Forbidden');
      expect(message).toBe('No tenés permisos para acceder a esta sección');
    }
  });

  it('should allow access when the user has at least one of several required roles (OR)', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN, Role.BORDADO]);

    expect(guard.canActivate(createContext(Role.TALLER, Role.BORDADO))).toBe(
      true,
    );
  });

  it('should allow access for a user holding multiple operational roles (diseno+bordado+dtf)', () => {
    reflector.getAllAndOverride.mockReturnValue([
      Role.RECEPCION,
      Role.ADMIN,
      Role.SUPERUSER,
      Role.TALLER,
      Role.DTF,
      Role.BORDADO,
      Role.DISENO,
      Role.LASER,
      Role.IMPRESIONES,
    ]);

    expect(
      guard.canActivate(createContext(Role.DISENO, Role.BORDADO, Role.DTF)),
    ).toBe(true);
  });

  it('should deny access when the request user has no roles at all', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: {} }),
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
