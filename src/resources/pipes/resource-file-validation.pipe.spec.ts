import { ErrorCode } from '../../common/errors/error-codes';
import { assertResourceDeclaredMimeMagic } from './resource-file-validation.pipe';

describe('assertResourceDeclaredMimeMagic', () => {
  it('accepts a PDF prefix', () => {
    expect(() =>
      assertResourceDeclaredMimeMagic(
        'application/pdf',
        Buffer.from('%PDF-1.7\n'),
      ),
    ).not.toThrow();
  });

  it('rejects a JPEG prefix declared as PDF', () => {
    expect(() =>
      assertResourceDeclaredMimeMagic(
        'application/pdf',
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      ),
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.RESOURCE_FILE_CONTENT_MISMATCH,
      }),
    );
  });
});
