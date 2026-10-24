import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from '../enums/roles.enum';
import { AreaAccess, type Access } from '../enums/area-access.enum';

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

    expect(() => guard.canActivate(createContext('taller'))).toThrow(
      ForbiddenException,
    );
  });

  it('nunca expone el mensaje crudo en inglés "Forbidden resource"', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);

    try {
      guard.canActivate(createContext('taller'));
      throw new Error('debería haber lanzado');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const message = (error as ForbiddenException).message;
      expect(message).not.toContain('Forbidden');
      expect(message).toBe('Sin permisos para acceder a esta sección');
    }
  });

  it('should allow access when the user has at least one of several required roles (OR)', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN, Role.RECEPCION]);

    expect(guard.canActivate(createContext('sucursal', 'recepcion'))).toBe(
      true,
    );
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

describe('RolesGuard: acceso por área', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new RolesGuard(reflector as unknown as Reflector);
  const contextFor = (user: { roles: string[]; areas: string[] }) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;
  const allows = (
    required: Access[],
    user: { roles: string[]; areas: string[] },
  ) => {
    reflector.getAllAndOverride.mockReturnValue(required);
    try {
      return guard.canActivate(contextFor(user));
    } catch {
      return false;
    }
  };

  it('AreaAccess.ANY deja pasar a quien trabaja en cualquier área, incluso una nueva', () => {
    expect(
      allows([AreaAccess.ANY], { roles: [], areas: ['impresion-3d'] }),
    ).toBe(true);
    expect(allows([AreaAccess.ANY], { roles: [], areas: [] })).toBe(false);
  });

  it('AreaAccess.PRODUCTION no cuenta a Diseño', () => {
    expect(
      allows([AreaAccess.PRODUCTION], { roles: [], areas: ['diseno'] }),
    ).toBe(false);
    expect(
      allows([AreaAccess.PRODUCTION], { roles: [], areas: ['diseno', 'dtf'] }),
    ).toBe(true);
  });

  it('AreaAccess.DESIGN y EMBROIDERY piden esa área en particular', () => {
    expect(allows([AreaAccess.DESIGN], { roles: [], areas: ['dtf'] })).toBe(
      false,
    );
    expect(allows([AreaAccess.DESIGN], { roles: [], areas: ['diseno'] })).toBe(
      true,
    );
    expect(
      allows([AreaAccess.EMBROIDERY], { roles: [], areas: ['bordado'] }),
    ).toBe(true);
  });

  it('un rol y un área se combinan con OR', () => {
    const required = [Role.RECEPCION, AreaAccess.PRODUCTION];
    expect(allows(required, { roles: ['recepcion'], areas: [] })).toBe(true);
    expect(allows(required, { roles: [], areas: ['laser'] })).toBe(true);
    expect(allows(required, { roles: ['sucursal'], areas: [] })).toBe(false);
  });

  it('un slug de área no cuenta como rol (no hay roles de área)', () => {
    expect(allows([Role.ADMIN], { roles: [], areas: ['admin'] })).toBe(false);
  });
});
