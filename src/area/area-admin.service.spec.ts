import { HttpException } from '@nestjs/common';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { slugifyAreaName } from './area-access';
import { AreaAdminService } from './area-admin.service';
import { AreaService, defaultAreaViews } from './area.service';
import { CreateAreaDto } from './dto/create-area.dto';

const dto = (over: Partial<CreateAreaDto> = {}): CreateAreaDto => ({
  name: 'Impresión 3D',
  icon: 'Box',
  color: '#7C3AED',
  ...over,
});

describe('slugifyAreaName', () => {
  it.each([
    ['Impresión 3D', 'impresion-3d'],
    ['  Serigrafía  ', 'serigrafia'],
    ['Ñandú & Co.', 'nandu-co'],
    ['!!!', ''],
  ])('%s → "%s"', (name, slug) => {
    expect(slugifyAreaName(name)).toBe(slug);
  });
});

describe('AreaAdminService', () => {
  let prisma: any;
  let tx: any;
  let areaService: AreaService;
  let audit: { record: jest.Mock };
  let service: AreaAdminService;

  const area = (over: Record<string, unknown> = {}) => ({
    ...defaultAreaViews()[0],
    id: 1,
    slug: 'taller',
    name: 'Taller',
    ...over,
  });

  beforeEach(() => {
    tx = {
      area: {
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 60 } }),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve(
              area({ id: 7, slug: data.slug, name: data.name, sortOrder: 70 }),
            ),
          ),
      },
      user: { create: jest.fn().mockResolvedValue({ id: 99 }) },
    };
    prisma = {
      area: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve(area({ ...data }))),
        findMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      order: { count: jest.fn().mockResolvedValue(0), groupBy: jest.fn() },
      orderAreaTask: {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn(),
      },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    areaService = AreaService.inMemory();
    jest.spyOn(areaService, 'invalidate');
    audit = { record: jest.fn() };
    service = new AreaAdminService(
      prisma as unknown as PrismaService,
      areaService,
      audit as unknown as AuditLogService,
    );
  });

  describe('create', () => {
    it('crea el área al final de la lista, con su cuenta compartida', async () => {
      const result = await service.create(dto(), 5);

      expect(tx.area.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slug: 'impresion-3d',
            name: 'Impresión 3D',
            color: '#7c3aed',
            sortOrder: 70,
            isProductionDestination: true,
            hasInventory: true,
            generalViewEnabled: true,
          }),
        }),
      );
      expect(tx.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            username: 'impresion-3d',
            firstName: 'Impresión 3D',
            isSharedAccount: true,
            areas: { connect: { id: 7 } },
          }),
        }),
      );
      expect(result).toMatchObject({
        slug: 'impresion-3d',
        sharedAccountId: 99,
        userCount: 1,
      });
      expect(areaService.invalidate).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 5, action: 'area.create' }),
      );
    });

    it('la contraseña de la cuenta compartida no es una conocida', async () => {
      await service.create(dto(), 5);
      const { password } = tx.user.create.mock.calls[0][0].data;
      expect(password).toMatch(/^\$2[aby]\$/);
    });

    it('sin cuenta compartida, y con usuarios y sugerencias de inventario', async () => {
      prisma.user.count.mockResolvedValue(2);

      const result = await service.create(
        dto({
          createSharedAccount: false,
          userIds: [3, 4, 3],
          inventoryCategories: ['Filamento'],
          inventoryUnits: ['kg', 'rollo'],
          isProductionDestination: false,
          hasInventory: false,
        }),
        5,
      );

      expect(tx.user.create).not.toHaveBeenCalled();
      expect(tx.area.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            users: { connect: [{ id: 3 }, { id: 4 }] },
            inventoryCategories: ['Filamento'],
            inventoryUnits: ['kg', 'rollo'],
            isProductionDestination: false,
            hasInventory: false,
          }),
        }),
      );
      expect(result.userCount).toBe(2);
    });

    it('rechaza un nombre repetido (sin importar mayúsculas ni acentos del slug)', async () => {
      prisma.area.findFirst.mockResolvedValue({ name: 'Láser' });

      await expect(
        service.create(dto({ name: 'LASER' }), 5),
      ).rejects.toMatchObject({ status: 409 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each(['Admin', 'Recepción', 'Todas'])(
      'rechaza el nombre reservado "%s"',
      async (name) => {
        await expect(service.create(dto({ name }), 5)).rejects.toMatchObject({
          status: 400,
        });
      },
    );

    it('rechaza Diseño (ya existe) y nombres sin letras ni números', async () => {
      await expect(
        service.create(dto({ name: 'Diseño' }), 5),
      ).rejects.toMatchObject({
        status: 409,
      });
      await expect(
        service.create(dto({ name: '!!' }), 5),
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('rechaza si el nombre de usuario de la cuenta compartida ya existe', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 1 });

      await expect(service.create(dto(), 5)).rejects.toThrow(
        /Ya existe un usuario/,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza usuarios que no existen', async () => {
      prisma.user.count.mockResolvedValue(1);

      await expect(
        service.create(dto({ userIds: [3, 4] }), 5),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('update', () => {
    it('edita nombre, ícono y color sin tocar el slug', async () => {
      prisma.area.findUnique.mockResolvedValue(area());

      await service.update(
        1,
        { name: 'Taller general', icon: 'Wrench', color: '#AA0000' },
        5,
      );

      expect(prisma.area.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: 'Taller general', icon: 'Wrench', color: '#aa0000' },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'area.update' }),
      );
    });

    it('404 si el área no existe', async () => {
      prisma.area.findUnique.mockResolvedValue(null);
      await expect(service.update(9, {}, 5)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('no deja renombrar a un nombre que ya tiene otra área', async () => {
      prisma.area.findUnique.mockResolvedValue(area());
      prisma.area.findFirst.mockResolvedValue({ name: 'DTF' });

      await expect(service.update(1, { name: 'dtf' }, 5)).rejects.toMatchObject(
        {
          status: 409,
        },
      );
    });

    it('desactiva un área sin trabajo abierto', async () => {
      prisma.area.findUnique.mockResolvedValue(area());

      await service.update(1, { active: false }, 5);

      expect(prisma.area.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { active: false } }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'area.deactivate' }),
      );
    });

    it('rechaza desactivarla con pedidos o tareas abiertos y dice cuántos', async () => {
      prisma.area.findUnique.mockResolvedValue(area());
      prisma.order.count.mockResolvedValue(2);
      prisma.orderAreaTask.count.mockResolvedValue(1);

      const error = await service
        .update(1, { active: false }, 5)
        .catch((e: HttpException) => e);

      expect(error).toMatchObject({ status: 409 });
      expect((error as HttpException).message).toMatch(
        /2 pedidos abiertos y 1 tarea sin terminar/,
      );
      expect(prisma.area.update).not.toHaveBeenCalled();
    });

    it('lo mismo al quitarla como destino de producción', async () => {
      prisma.area.findUnique.mockResolvedValue(area());
      prisma.orderAreaTask.count.mockResolvedValue(3);

      await expect(
        service.update(1, { isProductionDestination: false }, 5),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('reactivar un área queda en la bitácora como activación', async () => {
      prisma.area.findUnique.mockResolvedValue(area({ active: false }));

      await service.update(1, { active: true }, 5);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'area.activate' }),
      );
    });

    it('Diseño no se desactiva ni se vuelve destino de producción, pero sí se edita', async () => {
      prisma.area.findUnique.mockResolvedValue(
        area({
          id: 4,
          slug: 'diseno',
          name: 'Diseño',
          isDesign: true,
          isProductionDestination: false,
        }),
      );

      await expect(
        service.update(4, { active: false }, 5),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        service.update(4, { isProductionDestination: true }, 5),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        service.update(4, { color: '#112233' }, 5),
      ).resolves.toBeDefined();
    });
  });

  describe('overview', () => {
    it('suma usuarios, cuenta compartida y trabajo abierto de cada área', async () => {
      prisma.area.findMany.mockResolvedValue([
        { ...area(), _count: { users: 4 }, users: [{ id: 2 }] },
        {
          ...area({ id: 2, slug: 'dtf', name: 'DTF' }),
          _count: { users: 0 },
          users: [],
        },
      ]);
      prisma.orderAreaTask.groupBy.mockResolvedValue([
        { area: 'taller', _count: { _all: 3 } },
      ]);
      prisma.order.groupBy.mockResolvedValue([
        { area: 'taller', _count: { _all: 2 } },
      ]);

      const rows = await service.overview();

      expect(rows[0]).toMatchObject({
        slug: 'taller',
        users: 4,
        hasSharedAccount: true,
        openTasks: 3,
        openOrders: 2,
      });
      expect(rows[1]).toMatchObject({
        slug: 'dtf',
        users: 0,
        hasSharedAccount: false,
        openTasks: 0,
        openOrders: 0,
      });
    });
  });
});
