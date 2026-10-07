import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import * as jwt from 'jsonwebtoken';
import { Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { branchOrdersWhere } from 'src/branch/branch-access';
import {
  BRANCH_ONLY_ROOM,
  NotificationsGateway,
} from 'src/notifications/notifications.gateway';
import { OrderListQueryDto } from './dto/order-list-query.dto';
import { OrderService } from './order.service';

/**
 * Barrido de visibilidad SIN base de datos (siempre corre): superficie de
 * rutas, composición del `where` de GET /orders y avisos en tiempo real. La
 * contraparte contra Postgres real está en order.branch-visibility.db.spec.ts.
 */

const SRC = join(__dirname, '..');

function allControllers() {
  const found: { name: string; ctrl: any }[] = [];
  for (const dir of readdirSync(SRC, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of readdirSync(join(SRC, dir.name))) {
      if (!file.endsWith('.controller.ts')) continue;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(join(SRC, dir.name, file));
      for (const exported of Object.values(mod) as any[]) {
        if (
          typeof exported === 'function' &&
          Reflect.getMetadata(PATH_METADATA, exported) !== undefined
        ) {
          found.push({ name: exported.name, ctrl: exported });
        }
      }
    }
  }
  return found;
}

describe('Visibilidad de sucursales: superficie de rutas', () => {
  const reflector = new Reflector();
  const handlers: { id: string; roles: Role[] | undefined }[] = [];
  for (const { name, ctrl } of allControllers()) {
    for (const method of Object.getOwnPropertyNames(ctrl.prototype)) {
      const handler = ctrl.prototype[method];
      if (
        typeof handler !== 'function' ||
        Reflect.getMetadata(METHOD_METADATA, handler) === undefined
      ) {
        continue;
      }
      handlers.push({
        id: `${name}.${method}`,
        roles: reflector.getAllAndOverride<Role[]>(ROLES_KEY, [handler, ctrl]),
      });
    }
  }

  it('cotizaciones, historial, calendario, tablero, rendimiento, chat, inventario e insights NO están abiertos a la sucursal', () => {
    const orderBearing =
      /^(Quote|OrderHistory|ClientInsight|Calendar|Dashboard|Performance|Chat|Inventory|Restock|OrderTemplate|Log|AuditLog|Push|Company)/;
    const open = handlers.filter(
      (h) => orderBearing.test(h.id) && h.roles?.includes(Role.SUCURSAL),
    );
    expect(open.map((h) => h.id)).toEqual([]);
    // Sanidad: sí existen esas rutas (el patrón no quedó vacío).
    expect(handlers.some((h) => h.id.startsWith('QuoteController.'))).toBe(
      true,
    );
    expect(
      handlers.some((h) => h.id.startsWith('OrderHistoryController.')),
    ).toBe(true);
  });

  it('las rutas de OrderController abiertas a sucursal son SÓLO de lectura (más el alta)', () => {
    const open = handlers
      .filter(
        (h) =>
          h.id.startsWith('OrderController.') &&
          h.roles?.includes(Role.SUCURSAL),
      )
      .map((h) => h.id)
      .sort();
    expect(open).toEqual([
      'OrderController.create',
      'OrderController.findAll',
      'OrderController.findOne',
      'OrderController.getAreaTasks',
      'OrderController.getDesignRevisionFeedbackFile',
      'OrderController.getDesignRevisionFile',
      'OrderController.getDesignRevisionMontage',
      'OrderController.getDesignRevisions',
    ]);
  });

  it('las únicas rutas SIN roles (cualquier autenticado) son las que no tocan pedidos', () => {
    const noRoles = handlers
      .filter((h) => !h.roles)
      .map((h) => h.id)
      .sort();
    expect(noRoles).toEqual([
      'AuthController.login',
      'AuthController.refresh',
      'BugReportController.create',
      'HealthController.liveness',
      'HealthController.readiness',
      'PushController.getVapidPublicKey',
      'SettingsController.findOne',
      'UserController.getMyPreferences',
      'UserController.updateMyPreferences',
    ]);
  });
});

describe('Visibilidad de sucursales: where de GET /orders', () => {
  let prisma: any;
  let service: OrderService;
  const run = (query: Partial<OrderListQueryDto>, user: any) =>
    service.findAll(Object.assign(new OrderListQueryDto(), query), user);
  const lastWhere = () => prisma.order.findMany.mock.calls.at(-1)[0].where;

  beforeEach(() => {
    prisma = {
      order: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    };
    service = new OrderService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('cuenta de sucursal: branchId/origin se IGNORAN y el where es exactamente el de su sucursal', async () => {
    const user = { userId: 7, roles: ['sucursal'] };
    for (const q of [
      { branchId: 99 },
      { origin: 'matriz' as const },
      { origin: 'sucursal' as const, branchId: 3 },
    ]) {
      await run(q, user);
      expect(lastWhere()).toEqual(branchOrdersWhere(7));
    }
  });

  it('cuenta de sucursal: sus filtros propios (q, estado) van en AND sin quitar su sucursal', async () => {
    await run(
      { statusId: 4, branchId: 99 },
      { userId: 7, roles: ['sucursal'] },
    );
    expect(lastWhere()).toEqual({
      AND: [branchOrdersWhere(7), { statusId: 4 }],
    });
  });

  it.each(['recepcion', 'admin', 'superuser'])(
    '%s: origin y branchId se traducen a branchId null / not null / N',
    async (role) => {
      const user = { userId: 1, roles: [role] };
      await run({ origin: 'matriz' }, user);
      expect(lastWhere()).toEqual({ AND: [{}, { AND: [{ branchId: null }] }] });
      await run({ origin: 'sucursal' }, user);
      expect(lastWhere()).toEqual({
        AND: [{}, { AND: [{ branchId: { not: null } }] }],
      });
      await run({ branchId: 5 }, user);
      expect(lastWhere()).toEqual({ AND: [{}, { AND: [{ branchId: 5 }] }] });
      await run({}, user);
      expect(lastWhere()).toEqual({});
    },
  );

  it('un rol de área mantiene su filtro por área y le suma el origen en AND', async () => {
    await run({ origin: 'matriz' }, { userId: 3, roles: ['taller'] });
    expect(lastWhere()).toEqual({
      AND: [{ area: { in: ['taller'] } }, { AND: [{ branchId: null }] }],
    });
  });

  it('un usuario sin ningún rol que dé acceso no consulta nada', async () => {
    await expect(
      run({ origin: 'sucursal' }, { userId: 3, roles: [] }),
    ).resolves.toEqual([]);
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });
});

describe('Visibilidad de sucursales: tiempo real (WebSocket)', () => {
  const SECRET = 'secreto-de-prueba';
  let prisma: any;
  let gateway: NotificationsGateway;
  let server: any;

  const connect = async (roles: string[], sub = 7) => {
    const client: any = {
      handshake: {
        auth: { token: jwt.sign({ sub, username: 'u', roles }, SECRET) },
        headers: {},
      },
      join: jest.fn(),
      disconnect: jest.fn(),
      data: {},
    };
    await gateway.handleConnection(client);
    return client;
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ branchId: 4 }) },
    };
    gateway = new NotificationsGateway(
      { get: jest.fn().mockReturnValue(SECRET) } as any,
      prisma,
    );
    const op = { emit: jest.fn() };
    server = {
      emit: jest.fn(),
      to: jest.fn().mockReturnValue(op),
      except: jest.fn().mockReturnValue(op),
      sockets: { adapter: { rooms: new Map() } },
      __op: op,
    };
    gateway.server = server;
  });

  it('la cuenta sólo-sucursal entra al room "branch-only" y al de SU sucursal', async () => {
    const client = await connect(['sucursal']);
    const joined = client.join.mock.calls.map((c: any[]) => c[0]);
    expect(joined).toEqual(
      expect.arrayContaining([
        'sucursal',
        BRANCH_ONLY_ROOM,
        'branch:4',
        'user:7',
      ]),
    );
  });

  it.each([['recepcion'], ['admin'], ['taller'], ['diseno']])(
    '%s no entra a los rooms de sucursal',
    async (role) => {
      const client = await connect([role]);
      const joined = client.join.mock.calls.map((c: any[]) => c[0]);
      expect(joined).not.toContain(BRANCH_ONLY_ROOM);
      expect(joined.some((r: string) => r.startsWith('branch:'))).toBe(false);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it('un usuario con rol sucursal Y de matriz (no es cuenta de sucursal) conserva sus avisos', async () => {
    const client = await connect(['sucursal', 'recepcion']);
    expect(client.join.mock.calls.map((c: any[]) => c[0])).not.toContain(
      BRANCH_ONLY_ROOM,
    );
  });

  it('el cambio de estado YA NO es broadcast: excluye a las cuentas de sucursal ajenas', () => {
    gateway.notifyOrderStatusChange({
      id: 10,
      status: 'terminado',
      branchId: null,
    });
    expect(server.except).toHaveBeenCalledWith(BRANCH_ONLY_ROOM);
    expect(server.emit).not.toHaveBeenCalled(); // nada salió con server.emit directo
    expect(server.to).not.toHaveBeenCalled(); // pedido de matriz: ninguna sucursal
    expect(server.__op.emit).toHaveBeenCalledTimes(1);
  });

  it('el cambio de estado de un pedido de sucursal llega SÓLO a esa sucursal (y a la matriz)', () => {
    gateway.notifyOrderStatusChange({
      id: 11,
      status: 'terminado',
      branchId: 4,
    });
    expect(server.except).toHaveBeenCalledWith(BRANCH_ONLY_ROOM);
    expect(server.to).toHaveBeenCalledTimes(1);
    expect(server.to).toHaveBeenCalledWith('branch:4');
    expect(server.emit).not.toHaveBeenCalled();
  });

  it('el gateway sólo hace broadcast (server.emit) de presencia y "dataChanged" (sin datos de pedidos)', () => {
    const source = readFileSync(
      join(SRC, 'notifications', 'notifications.gateway.ts'),
      'utf8',
    );
    const events = [
      ...source.matchAll(/this\.server\??\.emit\(\s*'([^']+)'/g),
    ].map((m) => m[1]);
    expect(events.sort()).toEqual([
      'dataChanged',
      'presenceChanged',
      'presenceChanged',
    ]);
  });

  it('"dataChanged" lleva sólo nombres de modelos, no pedidos', () => {
    gateway.notifyDataChanged(['Order']);
    expect(server.emit).toHaveBeenCalledWith('dataChanged', {
      models: ['Order'],
    });
  });
});
