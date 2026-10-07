/** Imágenes mínimas para los tests de los logos de sucursal (no es de producción). */

const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/** PNG válido (firma real) con el ancho/alto indicados en su IHDR. */
export function makePng(width = 1, height = 1): Buffer {
  const png = Buffer.from(MINIMAL_PNG_BASE64, 'base64');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

/** JPEG con cabecera JFIF y un SOF0 con el ancho/alto indicados. */
export function makeJpeg(width = 1, height = 1, padTo = 0): Buffer {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  const head = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  const body = Buffer.concat([head, sof, Buffer.from([0xff, 0xd9])]);
  return padTo > body.length
    ? Buffer.concat([body, Buffer.alloc(padTo - body.length)])
    : body;
}

/** WebP (contenedor VP8X) con el ancho/alto indicados. */
export function makeWebp(width = 1, height = 1): Buffer {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write('WEBP', 8, 'latin1');
  buf.write('VP8X', 12, 'latin1');
  buf.writeUInt32LE(10, 16);
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return buf;
}

export const dataUrl = (mime: string, bytes: Buffer | string) =>
  `data:${mime};base64,${
    typeof bytes === 'string' ? bytes : bytes.toString('base64')
  }`;
