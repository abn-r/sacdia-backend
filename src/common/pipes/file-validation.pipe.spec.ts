import { ErrorCode } from '../errors/error-codes';
import {
  FileValidationPipe,
  fileBufferMatchesDeclaredMime,
} from './file-validation.pipe';

const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeFile(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'photo.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: jpegBuffer.length,
    buffer: jpegBuffer,
    destination: '',
    filename: 'photo.jpg',
    path: '',
    stream: undefined as never,
    ...overrides,
  };
}

describe('fileBufferMatchesDeclaredMime', () => {
  it('accepts a JPEG buffer declared as image/jpeg', () => {
    expect(fileBufferMatchesDeclaredMime(makeFile())).toBe(true);
  });

  it('rejects a PNG buffer declared as image/jpeg', () => {
    expect(
      fileBufferMatchesDeclaredMime(
        makeFile({ mimetype: 'image/jpeg', buffer: pngBuffer }),
      ),
    ).toBe(false);
  });

  // S4: a WebP file is a RIFF container: "RIFF" at 0 AND "WEBP" at 8.
  const webp = (riff: number[]) =>
    Buffer.from([...riff, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);

  it('accepts a real WebP header (RIFF....WEBP)', () => {
    expect(
      fileBufferMatchesDeclaredMime(
        makeFile({
          mimetype: 'image/webp',
          buffer: webp([0x52, 0x49, 0x46, 0x46]),
        }),
      ),
    ).toBe(true);
  });

  it('rejects "WEBP" at offset 8 without the RIFF header', () => {
    expect(
      fileBufferMatchesDeclaredMime(
        makeFile({
          mimetype: 'image/webp',
          buffer: webp([0x4d, 0x5a, 0x90, 0x00]),
        }),
      ),
    ).toBe(false);
  });

  it('rejects a RIFF container that is not WebP (e.g. WAVE)', () => {
    expect(
      fileBufferMatchesDeclaredMime(
        makeFile({
          mimetype: 'image/webp',
          buffer: Buffer.from([
            0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
          ]),
        }),
      ),
    ).toBe(false);
  });

  it('rejects a missing buffer', () => {
    expect(
      fileBufferMatchesDeclaredMime(
        makeFile({ buffer: undefined as unknown as Buffer }),
      ),
    ).toBe(false);
  });
});

describe('FileValidationPipe', () => {
  const pipe = new FileValidationPipe({
    allowedMimeTypes: ['image/jpeg', 'image/png'],
  });

  it('returns the file when MIME and magic bytes match', () => {
    const file = makeFile();
    expect(pipe.transform(file)).toBe(file);
  });

  it('rejects MIME spoofing', () => {
    expect(() =>
      pipe.transform(makeFile({ mimetype: 'image/jpeg', buffer: pngBuffer })),
    ).toThrow(expect.objectContaining({ code: ErrorCode.FILE_TYPE_INVALID }));
  });
});
