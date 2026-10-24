import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DEFAULT_AREAS } from './default-areas';
import { AREA_STAGES_INCLUDE, type AreaStageView } from './area-stages';
import {
  AREA_FIELDS_INCLUDE,
  AREA_MACHINES_INCLUDE,
  type AreaFieldView,
  type AreaMachineView,
} from './area-config';

/** Lo que el resto de la app necesita saber de un área (ver model Area). */
export interface AreaView {
  id: number;
  slug: string;
  name: string;
  icon: string;
  color: string;
  isDesign: boolean;
  isProductionDestination: boolean;
  hasInventory: boolean;
  generalViewEnabled: boolean;
  /** Sugerencias de categoría/unidad al dar de alta artículos de inventario del área. */
  inventoryCategories: string[];
  inventoryUnits: string[];
  sortOrder: number;
  active: boolean;
  /** Etapas previas a producción (activas, en orden); vacío = las tareas nacen listas para producir. */
  stages: AreaStageView[];
  /** Tareas abiertas que el área puede llevar a la vez (null = sin tope). */
  capacity: number | null;
  /** Horas típicas de producción por tarea (null = sin dato). */
  turnaroundHours: number | null;
  /** Máquinas o equipos activos del área. */
  machines: AreaMachineView[];
  /** Datos propios que se capturan en cada tarea del área (activos, en orden). */
  fields: AreaFieldView[];
}

/**
 * Para qué se usa un área al validarla:
 * - `any`: cualquier área activa (Diseño incluido), p. ej. `Order.area`.
 * - `production`: destino de producción (activa, nunca Diseño).
 */
export type AreaUse = 'any' | 'production';

export const AREA_SELECT = {
  id: true,
  slug: true,
  name: true,
  icon: true,
  color: true,
  isDesign: true,
  isProductionDestination: true,
  hasInventory: true,
  generalViewEnabled: true,
  inventoryCategories: true,
  inventoryUnits: true,
  sortOrder: true,
  active: true,
  stages: AREA_STAGES_INCLUDE,
  capacity: true,
  turnaroundHours: true,
  machines: AREA_MACHINES_INCLUDE,
  fields: AREA_FIELDS_INCLUDE,
} as const;

/**
 * Catálogo de áreas. Casi todas las rutas de pedidos, tareas e inventario lo
 * consultan, así que se guarda en memoria unos segundos; cualquier escritura
 * pasa por aquí e invalida la copia. Con varias instancias, un cambio hecho
 * en otra tarda a lo sumo `CACHE_TTL_MS` en verse.
 */
@Injectable()
export class AreaService {
  static readonly CACHE_TTL_MS = 30_000;

  private cache: { expiresAt: number; areas: AreaView[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Catálogo fijo en memoria con las seis áreas de siempre, para los tests
   * que construyen servicios a mano (en la app lo inyecta AreaModule).
   */
  static inMemory(areas: AreaView[] = defaultAreaViews()): AreaService {
    const service = new AreaService(null as unknown as PrismaService);
    service.load = async () => areas.map((area) => ({ ...area }));
    return service;
  }

  /** Áreas ordenadas para listas y selectores; por defecto sólo las activas. */
  async findAll(options: { includeInactive?: boolean } = {}) {
    const areas = await this.cached();
    return options.includeInactive ? areas : areas.filter((a) => a.active);
  }

  async findBySlug(slug: string): Promise<AreaView | null> {
    return (await this.cached()).find((a) => a.slug === slug) ?? null;
  }

  /** Slugs de las áreas activas que sirven para `use`. */
  async slugs(use: AreaUse = 'any'): Promise<string[]> {
    const areas = await this.findAll();
    return areas.filter((a) => fitsUse(a, use)).map((a) => a.slug);
  }

  /** Etapas previas a producción de un área; vacío si no tiene o no existe. */
  async stagesOf(slug: string): Promise<AreaStageView[]> {
    return (await this.findBySlug(slug))?.stages ?? [];
  }

  /** Slugs de las áreas activas con inventario propio. */
  async inventorySlugs(): Promise<string[]> {
    const areas = await this.findAll();
    return areas.filter((a) => a.hasInventory).map((a) => a.slug);
  }

  /** Nombre visible de un área; el slug tal cual si no está en el catálogo. */
  async labelOf(slug: string | null | undefined): Promise<string> {
    if (!slug) return 'Área';
    return (await this.findBySlug(slug))?.name ?? slug;
  }

  /**
   * 400 si `slug` no es un área activa válida para `use`. Las áreas llegan
   * como texto libre en los DTOs: aquí es donde se comprueba que existan.
   */
  async assertArea(
    slug: string | null | undefined,
    use: AreaUse = 'any',
    field = 'area',
  ): Promise<void> {
    if (slug === null || slug === undefined) return;
    const valid = await this.slugs(use);
    if (!valid.includes(slug)) {
      throw new HttpException(
        `${field} inválida: "${slug}". Debe ser una de: ${valid.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /** Igual que `assertArea`, para una lista de áreas. */
  async assertAreas(
    slugs: readonly string[] | null | undefined,
    use: AreaUse = 'any',
    field = 'areas',
  ): Promise<void> {
    for (const slug of slugs ?? []) {
      await this.assertArea(slug, use, field);
    }
  }

  /**
   * Cambia la visibilidad general de un área (ver Area.generalViewEnabled).
   * Devuelve null si el área no existe.
   */
  async setGeneralView(
    slug: string,
    generalViewEnabled: boolean,
  ): Promise<AreaView | null> {
    const existing = await this.prisma.area.findUnique({ where: { slug } });
    if (!existing) return null;
    const area = await this.prisma.area.update({
      where: { slug },
      data: { generalViewEnabled },
      select: AREA_SELECT,
    });
    this.invalidate();
    return area;
  }

  /** Descarta la copia en memoria: la siguiente lectura va a la base. */
  invalidate() {
    this.cache = null;
  }

  private async cached(): Promise<AreaView[]> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) return this.cache.areas;
    const areas = await this.load();
    this.cache = { expiresAt: now + AreaService.CACHE_TTL_MS, areas };
    return areas;
  }

  private load = async (): Promise<AreaView[]> =>
    this.prisma.area.findMany({
      select: AREA_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
}

function fitsUse(area: AreaView, use: AreaUse): boolean {
  if (use === 'production') {
    return area.isProductionDestination && !area.isDesign;
  }
  return true;
}

/** Las seis áreas de `DEFAULT_AREAS` con la forma de `AreaView`. */
export function defaultAreaViews(): AreaView[] {
  return DEFAULT_AREAS.map((area, index) => ({
    id: index + 1,
    ...area,
    isProductionDestination: !area.isDesign,
    hasInventory: true,
    generalViewEnabled: true,
    inventoryCategories: [],
    inventoryUnits: [],
    active: true,
    capacity: null,
    turnaroundHours: null,
    machines: [],
    fields: [],
    stages: (area.stages ?? []).map((stage, stageIndex) => ({
      id: (index + 1) * 100 + stageIndex + 1,
      ...stage,
    })),
  }));
}
