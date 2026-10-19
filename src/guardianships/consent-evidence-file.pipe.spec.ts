import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  ConsentEvidenceFilePipe,
  MAX_CONSENT_EVIDENCE_BYTES,
} from './consent-evidence-file.pipe';

const PDF = Buffer.from('%PDF-1.7 fake');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);

function file(
  mimetype: string,
  buffer: Buffer,
  size = buffer.length,
): Express.Multer.File {
  return { mimetype, buffer, size, originalname: 'f.bin' } as never;
}

function codeOf(fn: () => unknown): ErrorCode | undefined {
  try {
    fn();
  } catch (error) {
    return (error as AppException).code;
  }
  return undefined;
}

describe('ConsentEvidenceFilePipe', () => {
  const pipe = new ConsentEvidenceFilePipe();

  it.each([
    ['image/jpeg', JPEG],
    ['image/png', PNG],
    ['image/webp', WEBP],
    ['application/pdf', PDF],
  ])('accepts a real %s', (mime, buffer) => {
    const input = file(mime, buffer);
    expect(pipe.transform(input)).toBe(input);
  });

  it('requires a file', () => {
    expect(codeOf(() => pipe.transform(undefined))).toBe(
      ErrorCode.FILE_REQUIRED,
    );
  });

  it('rejects a spoofed type: a .jpg that is really an executable', () => {
    expect(codeOf(() => pipe.transform(file('image/jpeg', EXE)))).toBe(
      ErrorCode.FILE_TYPE_INVALID,
    );
    expect(codeOf(() => pipe.transform(file('application/pdf', JPEG)))).toBe(
      ErrorCode.FILE_TYPE_INVALID,
    );
  });

  it('rejects HEIC (the app converts to JPEG before uploading)', () => {
    const heic = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68]);
    expect(codeOf(() => pipe.transform(file('image/heic', heic)))).toBe(
      ErrorCode.FILE_TYPE_INVALID,
    );
  });

  it('rejects other types such as GIF or text', () => {
    expect(codeOf(() => pipe.transform(file('image/gif', JPEG)))).toBe(
      ErrorCode.FILE_TYPE_INVALID,
    );
    expect(codeOf(() => pipe.transform(file('text/plain', PDF)))).toBe(
      ErrorCode.FILE_TYPE_INVALID,
    );
  });

  it('rejects an 11 MB file and accepts exactly 10 MB', () => {
    expect(MAX_CONSENT_EVIDENCE_BYTES).toBe(10 * 1024 * 1024);
    expect(
      codeOf(() =>
        pipe.transform(file('application/pdf', PDF, 11 * 1024 * 1024)),
      ),
    ).toBe(ErrorCode.FILE_TOO_LARGE);
    expect(
      codeOf(() =>
        pipe.transform(
          file('application/pdf', PDF, MAX_CONSENT_EVIDENCE_BYTES),
        ),
      ),
    ).toBeUndefined();
  });
});
