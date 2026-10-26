/** Extensiones permitidas para el archivo final de producción. */
export const PRODUCTION_FILE_EXTENSIONS = [
  'zip',
  'eps',
  'svg',
  'dxf',
  'ai',
  'pdf',
  'jpg',
  'jpeg',
  'png',
] as const;

/** Tope por archivo: 5 GB (R2 admite mucho más; esto protege el costo). */
export const MAX_PRODUCTION_FILE_BYTES = 5 * 1024 * 1024 * 1024;

/** Tamaño de cada parte: 64 MiB (≥ 5 MiB que exige S3; 1 GB ≈ 16 partes). */
export const PRODUCTION_PART_SIZE = 64 * 1024 * 1024;

/** Vigencia de las URLs de subida (por parte) y de descarga. */
export const PRODUCTION_UPLOAD_URL_SECONDS = 3600;
export const PRODUCTION_DOWNLOAD_URL_SECONDS = 900;

/** Una subida `uploading` con más de estas horas se considera abandonada. */
export const STALE_UPLOAD_HOURS = 24;

export const PRODUCTION_FILE_STATUS = {
  uploading: 'uploading',
  ready: 'ready',
  deleted: 'deleted',
} as const;
