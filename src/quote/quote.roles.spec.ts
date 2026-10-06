import { HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { QuoteController } from './quote.controller';

/**
 * Roles de `/quotes` vía metadata de Nest (mismo criterio que RolesGuard:
 * handler y, si no hay, clase). Todo el tablero (leer y escribir) es sólo
 * de Recepción, admin y superuser; el resto de las áreas recibe 403.
 */
describe('QuoteController: roles y contrato de rutas', () => {
  const reflector = new Reflector();

  const rolesFor = (methodName: string): string[] => {
    const roles: Role[] =
      reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
        (QuoteController.prototype as any)[methodName],
        QuoteController,
      ]) ?? [];
    return [...roles].sort();
  };

  const QUOTE_ROLES = [Role.RECEPCION, Role.ADMIN, Role.SUPERUSER].sort();

  const ROUTES: [string, string, RequestMethod, string][] = [
    ['GET /quotes', 'findAll', RequestMethod.GET, '/'],
    ['POST /quotes', 'create', RequestMethod.POST, '/'],
    ['POST /quotes/bulk', 'createBulk', RequestMethod.POST, 'bulk'],
    ['PATCH /quotes/:id', 'update', RequestMethod.PATCH, ':id'],
    [
      'POST /quotes/:id/link-order',
      'linkOrder',
      RequestMethod.POST,
      ':id/link-order',
    ],
    ['DELETE /quotes/:id', 'remove', RequestMethod.DELETE, ':id'],
  ];

  it.each(ROUTES)(
    '%s sólo acepta recepcion, admin y superuser',
    (_name, method) => {
      expect(rolesFor(method)).toEqual(QUOTE_ROLES);
    },
  );

  it.each(
    Object.values(Role).filter(
      (role) => ![Role.RECEPCION, Role.ADMIN, Role.SUPERUSER].includes(role),
    ),
  )('el rol %s no entra a ninguna ruta (403)', (role) => {
    for (const [, method] of ROUTES) {
      expect(rolesFor(method)).not.toContain(role);
    }
  });

  it.each(ROUTES)(
    '%s (contrato con el frontend)',
    (_name, method, verb, path) => {
      const handler = (QuoteController.prototype as any)[method];
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(verb);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    },
  );

  it('cuelga de quotes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, QuoteController)).toBe('quotes');
  });

  it('DELETE responde 204 y link-order 200', () => {
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, QuoteController.prototype.remove),
    ).toBe(HttpStatus.NO_CONTENT);
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        QuoteController.prototype.linkOrder,
      ),
    ).toBe(HttpStatus.OK);
  });
});
