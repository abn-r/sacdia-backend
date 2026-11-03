import { ErrorCode } from '../errors/error-codes';
import { ParseUuidParamPipe } from './parse-uuid-param.pipe';

describe('ParseUuidParamPipe', () => {
  const pipe = new ParseUuidParamPipe();
  const meta = { type: 'param' as const, data: 'requestId' };

  it('returns a valid UUID untouched', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    await expect(pipe.transform(id, meta)).resolves.toBe(id);
  });

  it('rejects a malformed id with GUARD_ID_PARAM_INVALID (400)', async () => {
    await expect(pipe.transform('not-a-uuid', meta)).rejects.toMatchObject({
      code: ErrorCode.GUARD_ID_PARAM_INVALID,
      status: 400,
    });
  });

  it('lets undefined through when optional: true', async () => {
    const optional = new ParseUuidParamPipe({ optional: true });
    await expect(optional.transform(undefined, meta)).resolves.toBeUndefined();
  });

  it('still rejects a malformed id when optional: true', async () => {
    const optional = new ParseUuidParamPipe({ optional: true });
    await expect(optional.transform('nope', meta)).rejects.toMatchObject({
      code: ErrorCode.GUARD_ID_PARAM_INVALID,
      status: 400,
    });
  });

  it('rejects undefined by default', async () => {
    await expect(pipe.transform(undefined, meta)).rejects.toMatchObject({
      code: ErrorCode.GUARD_ID_PARAM_INVALID,
    });
  });
});
