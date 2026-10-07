import { pngDimensions } from './mockup-validation';

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Ancho y alto de una imagen PNG, JPEG o WebP leídos de su cabecera, sin
 * decodificarla. `null` si el buffer no es de ese formato o está truncado/
 * malformado (se trata como inválido). Sólo se llama DESPUÉS de confirmar el
 * tipo real con `file-type`.
 */
export function imageDimensions(
  buffer: Buffer,
  mime: string,
): ImageSize | null {
  switch (mime) {
    case 'image/png':
      return pngDimensions(buffer);
    case 'image/jpeg':
      return jpegDimensions(buffer);
    case 'image/webp':
      return webpDimensions(buffer);
    default:
      return null;
  }
}

/** Marcadores SOF (start of frame) que traen las dimensiones de un JPEG. */
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export function jpegDimensions(jpeg: Buffer): ImageSize | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= jpeg.length) {
    if (jpeg[offset] !== 0xff) return null;
    let marker = jpeg[offset + 1];
    // Relleno 0xFF entre segmentos.
    while (marker === 0xff && offset + 2 < jpeg.length) {
      offset += 1;
      marker = jpeg[offset + 1];
    }
    // Marcadores sin largo: TEM, RSTn, SOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    // Fin de imagen o inicio del scan sin haber visto un SOF.
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = jpeg.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (offset + 9 > jpeg.length) return null;
      return {
        height: jpeg.readUInt16BE(offset + 5),
        width: jpeg.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

export function webpDimensions(webp: Buffer): ImageSize | null {
  if (
    webp.length < 30 ||
    webp.toString('latin1', 0, 4) !== 'RIFF' ||
    webp.toString('latin1', 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  const chunk = webp.toString('latin1', 12, 16);
  if (chunk === 'VP8X') {
    // Lienzo de 24 bits (menos 1) para ancho y alto, little-endian.
    return {
      width: 1 + webp.readUIntLE(24, 3),
      height: 1 + webp.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8 ') {
    // Frame con pérdida: firma 9D 01 2A y dos enteros de 14 bits.
    if (webp[23] !== 0x9d || webp[24] !== 0x01 || webp[25] !== 0x2a) {
      return null;
    }
    return {
      width: webp.readUInt16LE(26) & 0x3fff,
      height: webp.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    // Sin pérdida: firma 0x2F y 14 bits de ancho y alto (menos 1).
    if (webp[20] !== 0x2f) return null;
    const bits = webp.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}
