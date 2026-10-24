/**
 * Las seis áreas con las que arranca el sistema (las que siembran la migración
 * 20261024120000_areas_catalog y `prisma db seed`). En la app el catálogo se
 * lee SIEMPRE de la tabla Area; esta lista sólo sirve para sembrar y como
 * catálogo por defecto de los tests que construyen servicios a mano.
 */
export interface AreaStageSeed {
  key: string;
  name: string;
  kind: 'work' | 'review';
}

/**
 * Etapas previas a producción de Bordado (WORKFLOW.md §3.1): digitalizar,
 * mandar una prueba y, con la prueba aprobada, producir. Las demás áreas
 * arrancan sin etapas.
 */
export const BORDADO_STAGES: readonly AreaStageSeed[] = [
  { key: 'digitalizado', name: 'Digitalizado', kind: 'work' },
  { key: 'en_pruebas', name: 'En pruebas', kind: 'review' },
];

export interface AreaSeed {
  slug: string;
  name: string;
  icon: string;
  color: string;
  isDesign: boolean;
  sortOrder: number;
  stages?: readonly AreaStageSeed[];
}

export const DEFAULT_AREAS: readonly AreaSeed[] = [
  {
    slug: 'taller',
    name: 'Taller',
    icon: 'Hammer',
    color: '#c5d629',
    isDesign: false,
    sortOrder: 10,
  },
  {
    slug: 'dtf',
    name: 'DTF',
    icon: 'Layers',
    color: '#30b7cf',
    isDesign: false,
    sortOrder: 20,
  },
  {
    slug: 'bordado',
    name: 'Bordado',
    icon: 'Scissors',
    color: '#e24091',
    isDesign: false,
    sortOrder: 30,
    stages: BORDADO_STAGES,
  },
  {
    slug: 'diseno',
    name: 'Diseño',
    icon: 'PenTool',
    color: '#6659c0',
    isDesign: true,
    sortOrder: 40,
  },
  {
    slug: 'laser',
    name: 'Láser',
    icon: 'Zap',
    color: '#f68a1e',
    isDesign: false,
    sortOrder: 50,
  },
  {
    slug: 'impresiones',
    name: 'Impresiones',
    icon: 'Printer',
    color: '#3583e9',
    isDesign: false,
    sortOrder: 60,
  },
];
