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
    ).toThrow(
      expect.objectContaining({ code: ErrorCode.FILE_TYPE_INVALID }),
    );
  });
});
