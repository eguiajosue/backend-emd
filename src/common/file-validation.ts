import { HttpException, HttpStatus } from '@nestjs/common';
// `file-type` v16 (última versión con build CJS -- v17+ es ESM-only, lo que
// rompe tanto el build de Nest como Jest con "module": "commonjs").
import { fromBuffer } from 'file-type';

/** Forma mínima de un archivo en base64 recibido del cliente. */
export interface Base64FileInput {
  data: string;
  filename: string;
  mimeType: string;
}

/**
 * Valida el tamaño decodificado y el tipo REAL (por contenido, no por el
 * `mimeType` que manda el cliente) de un archivo mandado en base64.
 *
 * `mimeType` ya debería estar restringido por `@IsIn(...)` a nivel de DTO,
 * pero eso sólo valida el STRING declarado por el cliente: nada impide
 * mandar un .html o un binario ejecutable con `mimeType: 'image/png'` y
 * `filename: 'x.png'`. `file-type` (magic bytes) confirma que el contenido
 * decodificado sea realmente uno de los formatos permitidos, y que coincida
 * con lo declarado.
 *
 * Extraído de `OrderService.assertOrderFileValid` para reusarlo
 * también en adjuntos de chat (fotos/documentos/audios).
 */
export async function assertBase64FileValid(
  file: Base64FileInput,
  options: {
    maxBytes: number;
    allowedMimeTypes: readonly string[];
    /** Mensaje de error para el tamaño, ya con el límite formateado. */
    sizeErrorMessage: string;
    /** Mensaje de error cuando el contenido no matchea ningún tipo permitido. */
    typeErrorMessage: string;
  },
): Promise<Buffer> {
  const buffer = Buffer.from(file.data, 'base64');
  if (buffer.length > options.maxBytes) {
    throw new HttpException(options.sizeErrorMessage, HttpStatus.BAD_REQUEST);
  }

  // `file-type` < 21.3.1 entra en loop infinito con ciertos ASF malformados
  // (GHSA-5v7r-6r5c-r473). v21+ es ESM-only (ver arriba), así que se corta
  // antes: ASF (wma/wmv) nunca es un tipo permitido aquí.
  if (startsWithAsfHeader(buffer)) {
    throw new HttpException(options.typeErrorMessage, HttpStatus.BAD_REQUEST);
  }

  const detected = await fromBuffer(buffer);

  if (!detected || !options.allowedMimeTypes.includes(detected.mime)) {
    throw new HttpException(options.typeErrorMessage, HttpStatus.BAD_REQUEST);
  }

  if (detected.mime !== file.mimeType) {
    throw new HttpException(
      'El tipo de archivo declarado no coincide con su contenido real',
      HttpStatus.BAD_REQUEST,
    );
  }

  return buffer;
}

/** GUID del header ASF: 30 26 B2 75 8E 66 CF 11 A6 D9 00 AA 00 62 CE 6C. */
const ASF_HEADER_GUID = Buffer.from('3026b2758e66cf11a6d900aa0062ce6c', 'hex');

function startsWithAsfHeader(buffer: Buffer): boolean {
  return (
    buffer.length >= ASF_HEADER_GUID.length &&
    buffer.subarray(0, ASF_HEADER_GUID.length).equals(ASF_HEADER_GUID)
  );
}
