import { ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../config/i18n-validation-details';
import { ResetPasswordRequestDto } from './reset-password-request.dto';

const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

async function ok(value: unknown): Promise<boolean> {
  try {
    await pipe.transform(value, {
      type: 'body',
      metatype: ResetPasswordRequestDto,
    });
    return true;
  } catch {
    return false;
  }
}

describe('ResetPasswordRequestDto', () => {
  it('accepts an email', async () => {
    expect(await ok({ email: 'juan.garcia@example.com' })).toBe(true);
  });

  it('accepts something shaped like a login handle (neutral answer, not a 400)', async () => {
    expect(await ok({ email: 'ana-7kq4m9tx' })).toBe(true);
    expect(await ok({ email: 'ANA-7KQ4M9TX' })).toBe(true);
  });

  it.each([
    ['a malformed email', 'juan@'],
    ['a too short value', 'ab'],
    ['spaces inside', 'ana 7kq4m9tx'],
    ['an empty string', ''],
    ['a sql-ish string', "x'; drop table users;--"],
  ])('rejects %s', async (_label, email) => {
    expect(await ok({ email })).toBe(false);
  });

  it('rejects a non-string and a missing value', async () => {
    expect(await ok({ email: { $ne: null } })).toBe(false);
    expect(await ok({})).toBe(false);
  });
});
