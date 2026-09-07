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
 * Extraído de `OrderService.assertAuthorizationFileSize` para reusarlo
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
