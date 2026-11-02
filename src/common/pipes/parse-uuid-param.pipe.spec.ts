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
});
