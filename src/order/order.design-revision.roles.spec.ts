import { Reflector } from '@nestjs/core';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { OrderController } from './order.controller';

/**
 * La hoja de autorización (montaje de la ronda autorizada) se muestra en el
 * detalle del pedido para TODOS los que lo pueden abrir, Producción incluida:
 * las rutas de LECTURA de rondas aceptan los mismos roles que GET /orders/:id
 * y la visibilidad por pedido la decide `assertOrderAccess` en el servicio.
 * Las de ESCRITURA siguen restringidas (WORKFLOW.md §2).
 */
describe('OrderController: roles de las rondas de diseño', () => {
  const reflector = new Reflector();

  const rolesFor = (methodName: keyof OrderController): string[] => {
    const roles: Role[] =
      reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
        OrderController.prototype[methodName] as () => unknown,
        OrderController,
      ]) ?? [];
    return [...roles].sort();
  };

  const ORDER_DETAIL_ROLES = [
    Role.RECEPCION,
    Role.ADMIN,
    Role.SUPERUSER,
    Role.TALLER,
    Role.DTF,
    Role.BORDADO,
    Role.DISENO,
    Role.LASER,
    Role.IMPRESIONES,
  ].sort();

  it.each([
    ['GET /orders/:id/design-revisions', 'getDesignRevisions'],
    [
      'GET /orders/:id/design-revisions/:revisionId/montage',
      'getDesignRevisionMontage',
    ],
    [
      'GET /orders/:id/design-revisions/:revisionId/files/:fileId',
      'getDesignRevisionFile',
    ],
    [
      'GET /orders/:id/design-revisions/:revisionId/feedback-file',
      'getDesignRevisionFeedbackFile',
    ],
  ] as const)(
    '%s acepta los mismos roles que GET /orders/:id',
    (_n, method) => {
      expect(rolesFor(method)).toEqual(rolesFor('findOne'));
      expect(rolesFor(method)).toEqual(ORDER_DETAIL_ROLES);
    },
  );

  it('las escrituras no cambian: montaje Diseño; feedback y autorización Recepción', () => {
    expect(rolesFor('createDesignRevision')).toEqual(
      [Role.DISENO, Role.ADMIN, Role.SUPERUSER].sort(),
    );
    expect(rolesFor('addDesignFeedback')).toEqual(
      [Role.RECEPCION, Role.ADMIN, Role.SUPERUSER].sort(),
    );
    expect(rolesFor('approveDesignRevision')).toEqual(
      [Role.RECEPCION, Role.ADMIN, Role.SUPERUSER].sort(),
    );
  });

  describe('delegan la visibilidad del pedido en el servicio', () => {
    const user = { sub: 7, username: 'bordado', roles: ['bordado'] };
    let orderService: Record<string, jest.Mock>;
    let controller: OrderController;

    beforeEach(() => {
      orderService = {
        getDesignRevisions: jest.fn().mockResolvedValue([]),
        getDesignRevisionMontageFile: jest.fn().mockResolvedValue({}),
        getDesignRevisionFile: jest.fn().mockResolvedValue({}),
      };
      controller = new OrderController(
        orderService as any,
        {} as any,
        {} as any,
      );
    });

    it('pasan el usuario del token (id y roles) al servicio', async () => {
      await controller.getDesignRevisions('42', user as any);
      await controller.getDesignRevisionMontage('42', '3', user as any);
      await controller.getDesignRevisionFile('42', '3', '9', user as any);

      const requester = { userId: 7, roles: ['bordado'] };
      expect(orderService.getDesignRevisions).toHaveBeenCalledWith(
        42,
        requester,
      );
      expect(orderService.getDesignRevisionMontageFile).toHaveBeenCalledWith(
        42,
        3,
        requester,
      );
      expect(orderService.getDesignRevisionFile).toHaveBeenCalledWith(
        42,
        3,
        9,
        requester,
      );
    });

    it('un 403 del servicio llega tal cual', async () => {
      orderService.getDesignRevisions.mockRejectedValue(
        new HttpException('Sin acceso a este pedido', HttpStatus.FORBIDDEN),
      );
      await expect(
        controller.getDesignRevisions('42', user as any),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });
  });
});
