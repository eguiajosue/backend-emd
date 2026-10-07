import { ClientService } from './client.service';

/** Cada sucursal tiene sus propios clientes; la matriz ve todos. */
describe('ClientService - clientes por sucursal', () => {
  let prisma: any;
  let service: ClientService;
  const branchUser = { userId: 7, roles: ['sucursal'] };
  const matriz = { userId: 2, roles: ['recepcion'] };
  const BRANCH = { id: 1, name: 'Punto Madero', active: true };

  beforeEach(() => {
    prisma = {
      client: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest
          .fn()
          .mockImplementation(async ({ data }) => ({ id: 1, ...data })),
        update: jest.fn().mockResolvedValue({ id: 3 }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ branch: BRANCH }) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    service = new ClientService(prisma);
  });

  describe('lista', () => {
    it('la sucursal sólo ve los suyos, aunque pida otro branchId o scope', async () => {
      await service.findAll(
        { branchId: 2, scope: 'matriz' } as any,
        branchUser,
      );
      expect(prisma.client.findMany.mock.calls[0][0].where).toEqual({
        branchId: 1,
      });
    });

    it('la sucursal pagina y cuenta sólo los suyos', async () => {
      await service.findAll({ page: 1, limit: 10 }, branchUser);
      expect(prisma.client.findMany.mock.calls[0][0].where).toEqual({
        branchId: 1,
      });
      expect(prisma.client.count).toHaveBeenCalledWith({
        where: { branchId: 1 },
      });
    });

    it('la matriz ve todos (sin filtro) e incluye la sucursal', async () => {
      await service.findAll(undefined, matriz);
      const args = prisma.client.findMany.mock.calls[0][0];
      expect(args.where).toEqual({});
      expect(args.include.branch).toEqual({ select: { id: true, name: true } });
    });

    it.each([
      [{ branchId: 3 }, { branchId: 3 }],
      [{ scope: 'matriz' }, { branchId: null }],
      [{ scope: 'sucursal' }, { branchId: { not: null } }],
    ])('la matriz filtra con %j', async (query, where) => {
      await service.findAll(query as any, matriz);
      expect(prisma.client.findMany.mock.calls[0][0].where).toEqual(where);
    });

    it('cuenta de sucursal sin sucursal asignada: 403', async () => {
      prisma.user.findUnique.mockResolvedValue({ branch: null });
      await expect(
        service.findAll(undefined, branchUser),
      ).rejects.toMatchObject({
        status: 403,
      });
    });
  });

  describe('get', () => {
    it('devuelve un cliente propio', async () => {
      prisma.client.findUnique.mockResolvedValue({ id: 3, branchId: 1 });
      await expect(service.findOne(3, branchUser)).resolves.toMatchObject({
        id: 3,
      });
    });

    it.each([[null], [2]])(
      '403 con un cliente ajeno (branchId=%s)',
      async (b) => {
        prisma.client.findUnique.mockResolvedValue({ id: 3, branchId: b });
        await expect(service.findOne(3, branchUser)).rejects.toMatchObject({
          status: 403,
        });
      },
    );

    it('404 si no existe', async () => {
      prisma.client.findUnique.mockResolvedValue(null);
      await expect(service.findOne(3, branchUser)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('la matriz lee cualquiera', async () => {
      prisma.client.findUnique.mockResolvedValue({ id: 3, branchId: 2 });
      await expect(service.findOne(3, matriz)).resolves.toMatchObject({
        id: 3,
      });
    });
  });

  describe('patch', () => {
    it('edita un cliente propio', async () => {
      prisma.client.findUnique.mockResolvedValue({ branchId: 1 });
      await service.update(3, { first_name: 'Ana' }, branchUser);
      expect(prisma.client.update.mock.calls[0][0].where).toEqual({ id: 3 });
    });

    it.each([[null], [2]])(
      '403 y no escribe con un cliente ajeno (%s)',
      async (b) => {
        prisma.client.findUnique.mockResolvedValue({ branchId: b });
        await expect(
          service.update(3, { first_name: 'X' }, branchUser),
        ).rejects.toMatchObject({ status: 403 });
        expect(prisma.client.update).not.toHaveBeenCalled();
      },
    );

    it('404 si no existe', async () => {
      prisma.client.findUnique.mockResolvedValue(null);
      await expect(
        service.update(3, { first_name: 'X' }, branchUser),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('no permite cambiar la sucursal dueña por la API', async () => {
      prisma.client.findUnique.mockResolvedValue({ branchId: 1 });
      await service.update(
        3,
        { first_name: 'A', branchId: 9 } as any,
        branchUser,
      );
      expect(prisma.client.update.mock.calls[0][0].data).toEqual({
        first_name: 'A',
      });
    });

    it('la matriz edita cualquiera sin consultar la sucursal', async () => {
      await service.update(3, { first_name: 'A' }, matriz);
      expect(prisma.client.findUnique).not.toHaveBeenCalled();
      expect(prisma.client.update).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('la sucursal fuerza SU branchId e ignora el del body', async () => {
      await service.create(
        { first_name: 'Ana', branchId: 99 } as any,
        branchUser,
      );
      expect(prisma.client.create.mock.calls[0][0].data).toEqual({
        first_name: 'Ana',
        branchId: 1,
      });
    });

    it('la sucursal inactiva no crea clientes (403)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        branch: { ...BRANCH, active: false },
      });
      await expect(
        service.create({ first_name: 'Ana' }, branchUser),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('la matriz crea con branchId null, aunque mande otro', async () => {
      await service.create({ first_name: 'Luis', branchId: 5 } as any, matriz);
      expect(prisma.client.create.mock.calls[0][0].data).toEqual({
        first_name: 'Luis',
        branchId: null,
      });
    });
  });
});
