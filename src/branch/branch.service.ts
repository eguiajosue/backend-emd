import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { STORAGE_FOLDERS, StorageService } from 'src/storage/storage.service';
import { assertActiveBranchEmployee, branchOfUser } from './branch-access';
import { assertBranchLogoValid, BranchLogoVariant } from './branch-logo';
import {
  CreateBranchDto,
  CreateBranchEmployeeDto,
  UpdateBranchDto,
  SetBranchLogoDto,
  UpdateBranchEmployeeDto,
} from './dto/branch.dto';

/**
 * Selección liviana de una sucursal: NUNCA las columnas de los logos (hasta
 * 400 KB cada una). Del logo sólo se lee el mime, que está si y sólo si la
 * variante tiene imagen; con eso se arman `hasLogoOnLight`/`hasLogoOnDark`.
 */
export const BRANCH_SELECT = {
  id: true,
  name: true,
  active: true,
  createdAt: true,
  logoOnLightMime: true,
  logoOnDarkMime: true,
  logoUpdatedAt: true,
} satisfies Prisma.BranchSelect;

type BranchRow = Prisma.BranchGetPayload<{ select: typeof BRANCH_SELECT }>;

/** Campos de columnas por variante del logo. */
const LOGO_FIELDS = {
  onLight: {
    data: 'logoOnLightData',
    key: 'logoOnLightKey',
    mime: 'logoOnLightMime',
  },
  onDark: {
    data: 'logoOnDarkData',
    key: 'logoOnDarkKey',
    mime: 'logoOnDarkMime',
  },
} as const;

/** Un elemento de `GET /branches/logos`. */
export interface BranchLogosItem {
  branchId: number;
  name: string;
  /** Data URL para fondos claros (logo negro), o null. */
  logoOnLight: string | null;
  /** Data URL para fondos oscuros (logo blanco), o null. */
  logoOnDark: string | null;
  /** ISO 8601 de la última vez que cambió algún logo, o null. */
  updatedAt: string | null;
}

/** Sucursal tal como la devuelve la API: sin imágenes, sólo si las tiene. */
export function toBranchView(row: BranchRow) {
  const { logoOnLightMime, logoOnDarkMime, ...rest } = row;
  return {
    ...rest,
    hasLogoOnLight: logoOnLightMime != null,
    hasLogoOnDark: logoOnDarkMime != null,
  };
}

/**
 * Sucursales (ej. "Punto Madero") y sus empleados. La sucursal entra con una
 * cuenta compartida (rol `sucursal`, `User.branchId`); al levantar un pedido
 * elige quién lo hizo de esta lista, que administra admin desde Usuarios.
 */
@Injectable()
export class BranchService {
  constructor(
    private readonly prisma: PrismaService,
    // Default sólo para los tests que construyen el service a mano: en la app
    // lo inyecta siempre StorageModule (global).
    private readonly storage: StorageService = StorageService.database(),
  ) {}

  async findAll() {
    const rows = await this.prisma.branch.findMany({
      orderBy: { name: 'asc' },
      select: {
        ...BRANCH_SELECT,
        employees: { orderBy: { name: 'asc' } },
      },
    });
    return rows.map((row) => toBranchView(row));
  }

  async create(dto: CreateBranchDto) {
    try {
      const row = await this.prisma.branch.create({
        data: { name: dto.name },
        select: BRANCH_SELECT,
      });
      return toBranchView(row);
    } catch (error) {
      throw this.mapUnique(error, 'Ya existe una sucursal con ese nombre');
    }
  }

  async update(id: number, dto: UpdateBranchDto) {
    await this.getBranchOrThrow(id);
    try {
      const row = await this.prisma.branch.update({
        where: { id },
        data: dto,
        select: BRANCH_SELECT,
      });
      return toBranchView(row);
    } catch (error) {
      throw this.mapUnique(error, 'Ya existe una sucursal con ese nombre');
    }
  }

  async findEmployees(branchId: number) {
    await this.getBranchOrThrow(branchId);
    return this.prisma.branchEmployee.findMany({
      where: { branchId },
      orderBy: { name: 'asc' },
    });
  }

  async createEmployee(branchId: number, dto: CreateBranchEmployeeDto) {
    await this.getBranchOrThrow(branchId);
    try {
      return await this.prisma.branchEmployee.create({
        data: { branchId, name: dto.name },
      });
    } catch (error) {
      throw this.mapUnique(
        error,
        'Ya hay un empleado con ese nombre en la sucursal',
      );
    }
  }

  async updateEmployee(
    branchId: number,
    employeeId: number,
    dto: UpdateBranchEmployeeDto,
  ) {
    const employee = await this.prisma.branchEmployee.findUnique({
      where: { id: employeeId },
    });
    if (!employee || employee.branchId !== branchId) {
      throw new HttpException('Empleado no encontrado', HttpStatus.NOT_FOUND);
    }
    try {
      return await this.prisma.branchEmployee.update({
        where: { id: employeeId },
        data: dto,
      });
    } catch (error) {
      throw this.mapUnique(
        error,
        'Ya hay un empleado con ese nombre en la sucursal',
      );
    }
  }

  /** Sucursal de la cuenta autenticada (rol `sucursal`). */
  async findMine(userId: number) {
    const branch = await this.branchOfUser(userId);
    const logos = await this.prisma.branch.findUnique({
      where: { id: branch.id },
      select: BRANCH_SELECT,
    });
    return {
      id: branch.id,
      name: branch.name,
      active: branch.active,
      hasLogoOnLight: logos?.logoOnLightMime != null,
      hasLogoOnDark: logos?.logoOnDarkMime != null,
      logoUpdatedAt: logos?.logoUpdatedAt ?? null,
      employees: await this.prisma.branchEmployee.findMany({
        where: { branchId: branch.id, active: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    };
  }

  /**
   * Logos de las sucursales ACTIVAS como data URLs, para las tarjetas de
   * producción y el Modo TV (lo lee cualquier usuario autenticado). Un logo
   * ilegible en el bucket sale null en vez de tirar abajo el listado.
   */
  async findLogos(): Promise<BranchLogosItem[]> {
    const rows = await this.prisma.branch.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        logoUpdatedAt: true,
        logoOnLightData: true,
        logoOnLightKey: true,
        logoOnLightMime: true,
        logoOnDarkData: true,
        logoOnDarkKey: true,
        logoOnDarkMime: true,
      },
    });
    const toDataUrl = async (
      mime: string | null,
      ref: { data: string | null; key: string | null },
    ) => {
      if (!mime) return null;
      const base64 = await this.storage.loadBase64OrNull(ref);
      return base64 == null ? null : `data:${mime};base64,${base64}`;
    };
    const items: BranchLogosItem[] = [];
    for (const row of rows) {
      items.push({
        branchId: row.id,
        name: row.name,
        logoOnLight: await toDataUrl(row.logoOnLightMime, {
          data: row.logoOnLightData,
          key: row.logoOnLightKey,
        }),
        logoOnDark: await toDataUrl(row.logoOnDarkMime, {
          data: row.logoOnDarkData,
          key: row.logoOnDarkKey,
        }),
        updatedAt: row.logoUpdatedAt ? row.logoUpdatedAt.toISOString() : null,
      });
    }
    return items;
  }

  /**
   * Guarda (o reemplaza) una variante del logo. 404 si la sucursal no existe;
   * 400/413 si la imagen no pasa la validación. El objeto anterior del bucket,
   * si lo había, se borra a mejor esfuerzo.
   */
  async setLogo(
    branchId: number,
    variant: BranchLogoVariant,
    dto: SetBranchLogoDto,
  ) {
    const fields = LOGO_FIELDS[variant];
    const existing = await this.getLogoRowOrThrow(branchId, variant);
    // Repite la validación del DTO: el service también se usa sin el pipe.
    const image = await assertBranchLogoValid(dto?.imageDataUrl);
    const blob = await this.storage.saveBase64(
      STORAGE_FOLDERS.branchLogo,
      image.base64,
      image.mime,
    );
    const updatedAt = new Date();
    try {
      await this.prisma.branch.update({
        where: { id: branchId },
        data: {
          [fields.data]: blob.data,
          [fields.key]: blob.key,
          [fields.mime]: image.mime,
          logoUpdatedAt: updatedAt,
        },
        select: { id: true },
      });
    } catch (error) {
      await this.storage.deleteQuietly([blob.key]);
      if ((error as { code?: string })?.code === 'P2025') {
        throw this.branchNotFound();
      }
      throw error;
    }
    if (existing.key && existing.key !== blob.key) {
      await this.storage.deleteQuietly([existing.key]);
    }
    return { branchId, variant, updatedAt: updatedAt.toISOString() };
  }

  /** Quita una variante del logo (idempotente; 404 si no existe la sucursal). */
  async removeLogo(branchId: number, variant: BranchLogoVariant) {
    const fields = LOGO_FIELDS[variant];
    const existing = await this.getLogoRowOrThrow(branchId, variant);
    await this.prisma.branch.update({
      where: { id: branchId },
      data: {
        [fields.data]: null,
        [fields.key]: null,
        [fields.mime]: null,
        logoUpdatedAt: new Date(),
      },
      select: { id: true },
    });
    await this.storage.deleteQuietly([existing.key]);
  }

  /** Clave del objeto de la variante (null si es legacy o no hay), o 404. */
  private async getLogoRowOrThrow(
    branchId: number,
    variant: BranchLogoVariant,
  ) {
    const fields = LOGO_FIELDS[variant];
    const row = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, [fields.key]: true },
    });
    if (!row) throw this.branchNotFound();
    return {
      key: (row as Record<string, unknown>)[fields.key] as string | null,
    };
  }

  private branchNotFound() {
    return new HttpException('Sucursal no encontrada', HttpStatus.NOT_FOUND);
  }

  branchOfUser(userId: number) {
    return branchOfUser(this.prisma, userId);
  }

  assertActiveEmployee(branchId: number, employeeId: number) {
    return assertActiveBranchEmployee(this.prisma, branchId, employeeId);
  }

  private async getBranchOrThrow(id: number) {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch) {
      throw new HttpException('Sucursal no encontrada', HttpStatus.NOT_FOUND);
    }
    return branch;
  }

  private mapUnique(error: unknown, message: string) {
    if ((error as { code?: string })?.code === 'P2002') {
      return new HttpException(message, HttpStatus.CONFLICT);
    }
    return error;
  }
}
