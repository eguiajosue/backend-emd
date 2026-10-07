import { HttpException, HttpStatus } from '@nestjs/common';
import { normalizeSizeBreakdown } from './garment-sizes';
import {
  isMockupVehiclePart,
  MOCKUP_VEHICLE_PART_MESSAGE,
} from './mockup-garments';

/**
 * Validaciones compartidas por los módulos de mockups (`order-mockup`,
 * `mockup-template`, `mockup-logo`): data URLs de imágenes en base64 y la
 * forma mínima de `MockupConfig` del estudio. Extraídas de
 * `OrderMockupService` para no duplicarlas (los mensajes con los textos por
 * defecto son los mismos que tenía ese service).
 */

/** `data:<mime>;base64,` al principio del data URL. */
const DATA_URL_PREFIX = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,/i;

/**
 * Alfabeto base64 estándar con padding final (el largo múltiplo de 4 se
 * chequea aparte). Clase de caracteres plana a propósito: un grupo repetido
 * (`(?:[…]{4})*`) revienta el stack de V8 con strings de varios MB.
 */
const BASE64_CHARS = /^[A-Za-z0-9+/]*={0,2}$/;

/** Prefijo obligatorio de cada diseño embebido en `config.layers[].dataUrl`. */
const LAYER_DATA_URL_PREFIX = 'data:image/png;base64,';

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Bytes que ocupa un string base64 ya decodificado, sin decodificarlo. */
export function base64DecodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Separa un data URL de imagen en su mime y su base64 (sin el prefijo). 400
 * si no es un data URL base64, si el mime declarado no está permitido o si el
 * base64 no es estricto. NO mira el tamaño ni el contenido real: eso va
 * después con `base64DecodedBytes` (413) y `assertBase64FileValid` (magic
 * bytes).
 *
 * @param subject sujeto de los mensajes, ej. "La imagen del mockup".
 * @param formats formatos para los mensajes, ej. "PNG o JPEG".
 */
export function parseImageDataUrl(
  value: unknown,
  options: {
    allowedMimeTypes: readonly string[];
    subject: string;
    formats: string;
  },
): { base64: string; mime: string } {
  const match = typeof value === 'string' ? DATA_URL_PREFIX.exec(value) : null;
  if (!match) {
    throw new HttpException(
      `${options.subject} debe ser un data URL en base64 (${options.formats})`,
      HttpStatus.BAD_REQUEST,
    );
  }
  const mime = match[1].toLowerCase();
  if (!options.allowedMimeTypes.includes(mime)) {
    throw new HttpException(
      `${options.subject} debe ser ${options.formats}`,
      HttpStatus.BAD_REQUEST,
    );
  }
  const base64 = (value as string).slice(match[0].length);
  // `Buffer.from(…, 'base64')` ignora caracteres inválidos y corta en el
  // padding: sin esto, una imagen válida seguida de basura pasa los magic
  // bytes y se guarda la basura (un NUL, además, rompe el INSERT con 500).
  if (base64.length % 4 !== 0 || !BASE64_CHARS.test(base64)) {
    throw new HttpException(
      `${options.subject} no es un base64 válido`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return { base64, mime };
}

/**
 * jsonb de Postgres rechaza `\u0000` ("unsupported Unicode escape
 * sequence"): mejor un 400 claro que un 500 del INSERT. Recibe el JSON ya
 * serializado (los callers lo necesitan también para medir el tamaño).
 */
export function assertJsonHasNoNul(json: string, message: string): void {
  if (json.includes('\\u0000')) {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
  }
}

/**
 * Validación liviana de `MockupConfig`: lo justo para que el estudio pueda
 * volver a abrirlo. Prenda igual a la indicada, `colors` objeto, `layers`
 * array de objetos y cada `dataUrl` de diseño, si viene, un PNG.
 *
 * @param of complemento de los mensajes, ej. "del mockup" o "de la plantilla".
 */
export function assertMockupConfigShape(
  config: unknown,
  garment: string,
  of: string,
): asserts config is Record<string, unknown> {
  const invalid = (message: string) =>
    new HttpException(message, HttpStatus.BAD_REQUEST);

  if (!isPlainObject(config)) {
    throw invalid(`La configuración ${of} es obligatoria`);
  }
  if (config.garment !== garment) {
    throw invalid(`La configuración no corresponde a la prenda ${of}`);
  }
  if (!isPlainObject(config.colors)) {
    throw invalid(`La configuración ${of} no tiene colores`);
  }
  if (!Array.isArray(config.layers)) {
    throw invalid(`La configuración ${of} no tiene la lista de diseños`);
  }
  for (const layer of config.layers) {
    if (!isPlainObject(layer)) {
      throw invalid(`Cada diseño ${of} debe ser un objeto`);
    }
    if (
      layer.dataUrl !== undefined &&
      (typeof layer.dataUrl !== 'string' ||
        !layer.dataUrl.startsWith(LAYER_DATA_URL_PREFIX))
    ) {
      throw invalid(`Cada diseño ${of} debe ser una imagen PNG`);
    }
  }
  // Tallas opcionales (panel "Tallas" del estudio). Mockups viejos no las
  // traen; si vienen, mismas reglas que en las líneas del pedido.
  if (config.sizes !== undefined) {
    normalizeSizeBreakdown(config.sizes, `Las tallas ${of}`);
  }
  // Parte del tráiler que se rotula (Rotulaciones). Opcional; sólo el tráiler
  // la usa ('full' | 'cab' | 'box'). Los demás mockups no la traen.
  if (config.vehiclePart !== undefined) {
    if (garment !== 'trailer') {
      throw invalid(
        `La parte del vehículo sólo aplica al tráiler (configuración ${of})`,
      );
    }
    if (!isMockupVehiclePart(config.vehiclePart)) {
      throw invalid(MOCKUP_VEHICLE_PART_MESSAGE);
    }
  }
}

/**
 * Ancho y alto de un PNG leídos de su cabecera IHDR (firma de 8 bytes, largo
 * y tipo del chunk, y luego ancho/alto en big-endian), sin decodificar la
 * imagen. `null` si el buffer no tiene un IHDR al principio.
 */
export function pngDimensions(
  png: Buffer,
): { width: number; height: number } | null {
  if (png.length < 24 || png.toString('latin1', 12, 16) !== 'IHDR') {
    return null;
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
