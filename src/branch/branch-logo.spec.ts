import { HttpStatus } from '@nestjs/common';
import {
  assertBranchLogoValid,
  MAX_BRANCH_LOGO_BYTES,
  ParseBranchLogoVariantPipe,
} from './branch-logo';
import { dataUrl, makeJpeg, makePng, makeWebp } from './branch-logo.fixtures';
import { imageDimensions } from 'src/common/image-dimensions';

const rejects = (value: unknown, status: number) =>
  expect(assertBranchLogoValid(value)).rejects.toMatchObject({ status });

describe('Validación del logo de sucursal', () => {
  it.each([
    ['PNG', 'image/png', makePng(300, 120)],
    ['JPEG', 'image/jpeg', makeJpeg(300, 120)],
    ['WebP', 'image/webp', makeWebp(300, 120)],
  ])('acepta un %s real', async (_n, mime, bytes) => {
    const result = await assertBranchLogoValid(dataUrl(mime, bytes));
    expect(result.mime).toBe(mime);
    expect(result.base64).toBe(bytes.toString('base64'));
  });

  it('acepta justo 2000×2000 y justo 400 KB', async () => {
    await expect(
      assertBranchLogoValid(dataUrl('image/png', makePng(2000, 2000))),
    ).resolves.toBeDefined();
    await expect(
      assertBranchLogoValid(
        dataUrl('image/jpeg', makeJpeg(10, 10, MAX_BRANCH_LOGO_BYTES)),
      ),
    ).resolves.toBeDefined();
  });

  it('rechaza SVG (400), aunque sea un SVG inofensivo', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await rejects(dataUrl('image/svg+xml', svg), HttpStatus.BAD_REQUEST);
  });

  it('rechaza un SVG que se hace pasar por PNG/JPEG/WebP (firma falsa)', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
      await rejects(dataUrl(mime, svg), HttpStatus.BAD_REQUEST);
    }
  });

  it('rechaza HTML o texto con mime de imagen', async () => {
    await rejects(
      dataUrl('image/png', Buffer.from('<html><script>1</script></html>')),
      HttpStatus.BAD_REQUEST,
    );
  });

  it('rechaza un mime mentiroso: el contenido real no coincide con el declarado', async () => {
    await rejects(
      dataUrl('image/png', makeJpeg(10, 10)),
      HttpStatus.BAD_REQUEST,
    );
    await rejects(
      dataUrl('image/jpeg', makePng(10, 10)),
      HttpStatus.BAD_REQUEST,
    );
    await rejects(
      dataUrl('image/webp', makePng(10, 10)),
      HttpStatus.BAD_REQUEST,
    );
    await rejects(
      dataUrl('image/png', makeWebp(10, 10)),
      HttpStatus.BAD_REQUEST,
    );
  });

  it('rechaza formatos de imagen no permitidos aunque sean reales (GIF)', async () => {
    const gif = Buffer.from(
      'R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
      'base64',
    );
    await rejects(dataUrl('image/gif', gif), HttpStatus.BAD_REQUEST);
    await rejects(dataUrl('image/png', gif), HttpStatus.BAD_REQUEST);
  });

  it('413 si pasa de 400 KB decodificado', async () => {
    await rejects(
      dataUrl('image/jpeg', makeJpeg(10, 10, MAX_BRANCH_LOGO_BYTES + 1)),
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  });

  it.each([
    ['ancho', makePng(2001, 10)],
    ['alto', makePng(10, 2001)],
  ])('rechaza un PNG con %s mayor a 2000 px', async (_n, png) => {
    await rejects(dataUrl('image/png', png), HttpStatus.BAD_REQUEST);
  });

  it('rechaza JPEG y WebP de más de 2000 px', async () => {
    await rejects(
      dataUrl('image/jpeg', makeJpeg(2001, 10)),
      HttpStatus.BAD_REQUEST,
    );
    await rejects(
      dataUrl('image/webp', makeWebp(10, 2001)),
      HttpStatus.BAD_REQUEST,
    );
  });

  it('rechaza dimensiones 0 o ilegibles (JPEG sin SOF, PNG sin IHDR)', async () => {
    await rejects(dataUrl('image/png', makePng(0, 10)), HttpStatus.BAD_REQUEST);
    // Cabecera JFIF sola: file-type lo ve como JPEG pero no hay SOF.
    const jfifOnly = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    ]);
    await rejects(dataUrl('image/jpeg', jfifOnly), HttpStatus.BAD_REQUEST);
  });

  it.each([
    ['no es string', 42],
    ['sin prefijo data:', makePng().toString('base64')],
    ['no es base64 (data:image/png;utf8)', 'data:image/png,abc'],
    ['base64 inválido', 'data:image/png;base64,iVBO*'],
    ['basura tras el padding', `${dataUrl('image/png', makePng())}AAAA`],
  ])('400 si %s', async (_n, value) => {
    await rejects(value, HttpStatus.BAD_REQUEST);
  });
});

describe('imageDimensions', () => {
  it('lee PNG, JPEG y WebP (VP8X)', () => {
    expect(imageDimensions(makePng(12, 34), 'image/png')).toEqual({
      width: 12,
      height: 34,
    });
    expect(imageDimensions(makeJpeg(640, 480), 'image/jpeg')).toEqual({
      width: 640,
      height: 480,
    });
    expect(imageDimensions(makeWebp(1999, 2000), 'image/webp')).toEqual({
      width: 1999,
      height: 2000,
    });
  });

  it('lee WebP con pérdida (VP8) y sin pérdida (VP8L)', () => {
    const lossy = Buffer.alloc(30);
    lossy.write('RIFF', 0, 'latin1');
    lossy.write('WEBP', 8, 'latin1');
    lossy.write('VP8 ', 12, 'latin1');
    lossy.set([0x9d, 0x01, 0x2a], 23);
    lossy.writeUInt16LE(320, 26);
    lossy.writeUInt16LE(200, 28);
    expect(imageDimensions(lossy, 'image/webp')).toEqual({
      width: 320,
      height: 200,
    });

    const lossless = Buffer.alloc(30);
    lossless.write('RIFF', 0, 'latin1');
    lossless.write('WEBP', 8, 'latin1');
    lossless.write('VP8L', 12, 'latin1');
    lossless[20] = 0x2f;
    lossless.writeUInt32LE((100 - 1) | ((50 - 1) << 14), 21);
    expect(imageDimensions(lossless, 'image/webp')).toEqual({
      width: 100,
      height: 50,
    });
  });

  it('devuelve null con basura, truncados o mimes no soportados', () => {
    expect(imageDimensions(Buffer.from('nada'), 'image/png')).toBeNull();
    expect(imageDimensions(Buffer.from([0xff, 0xd8]), 'image/jpeg')).toBeNull();
    expect(imageDimensions(Buffer.alloc(40), 'image/webp')).toBeNull();
    expect(imageDimensions(makePng(), 'image/svg+xml')).toBeNull();
  });
});

describe('ParseBranchLogoVariantPipe', () => {
  const pipe = new ParseBranchLogoVariantPipe();
  it('acepta onLight y onDark', () => {
    expect(pipe.transform('onLight')).toBe('onLight');
    expect(pipe.transform('onDark')).toBe('onDark');
  });
  it.each(['', 'light', 'ONLIGHT', 'onlight', '../x'])('400 con %p', (v) => {
    expect(() => pipe.transform(v)).toThrow(
      expect.objectContaining({ status: HttpStatus.BAD_REQUEST }),
    );
  });
});
