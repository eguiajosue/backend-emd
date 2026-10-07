import { HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { MockupLogoController } from './mockup-logo.controller';

/**
 * Roles de `/mockup-logos` vía metadata de Nest (mismo criterio que
 * RolesGuard: handler y, si no hay, clase). Todo, incluso leer, sólo para
 * Recepción, admin y superuser.
 */
describe('MockupLogoController: roles y contrato de rutas', () => {
  const reflector = new Reflector();

  const rolesFor = (target: any, methodName: string): string[] => {
    const roles: Role[] =
      reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
        target.prototype[methodName],
        target,
      ]) ?? [];
    return [...roles].sort();
  };

  const ROLES = [
    Role.RECEPCION,
    Role.ADMIN,
    Role.SUPERUSER,
    Role.DISENO,
  ].sort();

  // La cuenta de sucursal usa Mockups: lee, guarda y usa; renombrar y borrar
  // quedan para la matriz.
  it.each([
    ['GET /mockup-logos', 'findAll'],
    ['GET /mockup-logos/:id/image', 'findImage'],
    ['GET /mockup-logos/:id/thumbnail', 'findThumbnail'],
    ['POST /mockup-logos', 'create'],
    ['POST /mockup-logos/:id/use', 'markUsed'],
  ])('%s acepta recepcion, admin, superuser y sucursal', (_name, method) => {
    expect(rolesFor(MockupLogoController, method)).toEqual(
      [...ROLES, Role.SUCURSAL].sort(),
    );
  });

  it.each([
    ['PATCH /mockup-logos/:id', 'rename'],
    ['DELETE /mockup-logos/:id', 'remove'],
  ])('%s sólo acepta recepcion, admin y superuser', (_name, method) => {
    expect(rolesFor(MockupLogoController, method)).toEqual(ROLES);
  });

  it('cuelga de mockup-logos (contrato con el frontend)', () => {
    expect(Reflect.getMetadata(PATH_METADATA, MockupLogoController)).toBe(
      'mockup-logos',
    );
    const proto = MockupLogoController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, proto.findAll)).toBe('/');
    expect(Reflect.getMetadata(PATH_METADATA, proto.findImage)).toBe(
      ':id/image',
    );
    expect(Reflect.getMetadata(PATH_METADATA, proto.findThumbnail)).toBe(
      ':id/thumbnail',
    );
    expect(Reflect.getMetadata(PATH_METADATA, proto.create)).toBe('/');
    expect(Reflect.getMetadata(PATH_METADATA, proto.rename)).toBe(':id');
    expect(Reflect.getMetadata(PATH_METADATA, proto.markUsed)).toBe(':id/use');
    expect(Reflect.getMetadata(PATH_METADATA, proto.remove)).toBe(':id');
  });

  it.each(['markUsed', 'remove'])('%s responde 204 sin cuerpo', (method) => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        (MockupLogoController.prototype as any)[method],
      ),
    ).toBe(HttpStatus.NO_CONTENT);
  });

  it('POST (subida) tiene throttle propio de 20 por minuto, como las demás subidas', () => {
    const create = MockupLogoController.prototype.create;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', create)).toBe(20);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', create)).toBe(60000);
  });
});
