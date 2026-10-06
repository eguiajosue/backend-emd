import { HttpStatus } from '@nestjs/common';
import { assertBase64FileValid } from './file-validation';

const options = {
  maxBytes: 1024 * 1024,
  allowedMimeTypes: ['image/png'] as const,
  sizeErrorMessage: 'too big',
  typeErrorMessage: 'bad type',
};

describe('assertBase64FileValid', () => {
  it('rejects ASF content before handing it to file-type (GHSA-5v7r-6r5c-r473)', async () => {
    const asf = Buffer.concat([
      Buffer.from('3026b2758e66cf11a6d900aa0062ce6c', 'hex'),
      Buffer.alloc(64),
    ]);
    await expect(
      assertBase64FileValid(
        {
          data: asf.toString('base64'),
          filename: 'x.png',
          mimeType: 'image/png',
        },
        options,
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      message: 'bad type',
    });
  });

  it('still accepts a real PNG', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    await expect(
      assertBase64FileValid(
        {
          data: png.toString('base64'),
          filename: 'x.png',
          mimeType: 'image/png',
        },
        options,
      ),
    ).resolves.toBeInstanceOf(Buffer);
  });
});
