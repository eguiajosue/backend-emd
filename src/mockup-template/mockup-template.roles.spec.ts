import { HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { MockupTemplateController } from './mockup-template.controller';

/**
 * Roles de `/mockup-templates` vía metadata de Nest (mismo criterio que
 * RolesGuard: handler y, si no hay, clase). Todo, incluso leer, sólo para
 * Recepción, admin y superuser.
 */
describe('MockupTemplateController: roles y contrato de rutas', () => {
  const reflector = new Reflector();

  const rolesFor = (target: any, methodName: string): string[] => {
    const roles: Role[] =
      reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
        target.prototype[methodName],
        target,
      ]) ?? [];
    return [...roles].sort();
  };

  const ROLES = [Role.RECEPCION, Role.ADMIN, Role.SUPERUSER].sort();

  // La cuenta de sucursal usa Mockups: lee, guarda y usa; renombrar y borrar
  // quedan para la matriz.
  it.each([
    ['GET /mockup-templates', 'findAll'],
    ['GET /mockup-templates/:id', 'findOne'],
    ['POST /mockup-templates', 'create'],
  ])('%s acepta recepcion, admin, superuser y sucursal', (_name, method) => {
    expect(rolesFor(MockupTemplateController, method)).toEqual(
      [...ROLES, Role.SUCURSAL].sort(),
    );
  });

  it.each([
    ['PATCH /mockup-templates/:id', 'rename'],
    ['DELETE /mockup-templates/:id', 'remove'],
  ])('%s sólo acepta recepcion, admin y superuser', (_name, method) => {
    expect(rolesFor(MockupTemplateController, method)).toEqual(ROLES);
  });

  it('cuelga de mockup-templates (contrato con el frontend)', () => {
    expect(Reflect.getMetadata(PATH_METADATA, MockupTemplateController)).toBe(
      'mockup-templates',
    );
    const proto = MockupTemplateController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, proto.findAll)).toBe('/');
    expect(Reflect.getMetadata(PATH_METADATA, proto.findOne)).toBe(':id');
    expect(Reflect.getMetadata(PATH_METADATA, proto.create)).toBe('/');
    expect(Reflect.getMetadata(PATH_METADATA, proto.rename)).toBe(':id');
    expect(Reflect.getMetadata(PATH_METADATA, proto.remove)).toBe(':id');
  });

  it('DELETE responde 204 sin cuerpo', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        MockupTemplateController.prototype.remove,
      ),
    ).toBe(HttpStatus.NO_CONTENT);
  });

  it('POST (subida) tiene throttle propio de 20 por minuto, como las demás subidas', () => {
    const create = MockupTemplateController.prototype.create;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', create)).toBe(20);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', create)).toBe(60000);
  });
});
