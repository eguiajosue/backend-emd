/**
 * Íconos que puede tener un área (`Area.icon` guarda el nombre). Son nombres
 * de lucide-react y deben coincidir con `AREA_ICON_REGISTRY` del frontend
 * (apps/web/src/lib/areas.ts).
 */
export const AREA_ICONS = [
  'Hammer',
  'Layers',
  'Scissors',
  'PenTool',
  'Zap',
  'Printer',
  'Box',
  'Brush',
  'Flame',
  'Package',
  'Paintbrush',
  'Shirt',
  'Stamp',
  'Wrench',
  'Cuboid',
  'Cpu',
] as const;

export type AreaIcon = (typeof AREA_ICONS)[number];
