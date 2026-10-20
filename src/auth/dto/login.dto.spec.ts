import { ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../config/i18n-validation-details';
import { LoginDto, loginIdentifierOf } from './login.dto';

const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

async function validate(value: unknown) {
  try {
    return {
      ok: true as const,
      value: (await pipe.transform(value, {
        type: 'body',
        metatype: LoginDto,
      })) as LoginDto,
    };
  } catch {
    return { ok: false as const };
  }
}

describe('LoginDto', () => {
  it('accepts the legacy email field', async () => {
    const result = await validate({
      email: 'ana@example.com',
      password: 'Password123!',
    });
    expect(result.ok).toBe(true);
    expect(result.ok && loginIdentifierOf(result.value)).toBe(
      'ana@example.com',
    );
  });

  it('accepts a handle as identifier without any email-format check', async () => {
    const result = await validate({
      identifier: 'ana-7kq4m9tx',
      password: 'Password123!',
    });
    expect(result.ok).toBe(true);
    expect(result.ok && loginIdentifierOf(result.value)).toBe('ana-7kq4m9tx');
  });

  it('accepts an email as identifier', async () => {
    const result = await validate({
      identifier: 'ana@example.com',
      password: 'Password123!',
    });
    expect(result.ok).toBe(true);
  });

  it('trims the identifier', async () => {
    const result = await validate({
      identifier: '   Ana-7KQ4M9TX  ',
      password: 'Password123!',
    });
    expect(result.ok && result.value.identifier).toBe('Ana-7KQ4M9TX');
  });

  it('rejects both identifier and email', async () => {
    expect(
      (
        await validate({
          identifier: 'ana-7kq4m9tx',
          email: 'ana@example.com',
          password: 'Password123!',
        })
      ).ok,
    ).toBe(false);
  });

  it('rejects neither identifier nor email', async () => {
    expect((await validate({ password: 'Password123!' })).ok).toBe(false);
  });

  it('still validates the legacy email format', async () => {
    expect(
      (await validate({ email: 'not-an-email', password: 'Password123!' })).ok,
    ).toBe(false);
  });

  it('rejects a 10 000-character identifier at validation time (before any DB read)', async () => {
    expect(
      (
        await validate({
          identifier: 'a'.repeat(10_000),
          password: 'Password123!',
        })
      ).ok,
    ).toBe(false);
  });

  it.each(['ab', '', '   '])(
    'rejects a too short identifier %p',
    async (id) => {
      expect(
        (await validate({ identifier: id, password: 'Password123!' })).ok,
      ).toBe(false);
    },
  );

  it('accepts the 254-character boundary and rejects 255', async () => {
    expect(
      (await validate({ identifier: 'a'.repeat(254), password: 'p' })).ok,
    ).toBe(true);
    expect(
      (await validate({ identifier: 'a'.repeat(255), password: 'p' })).ok,
    ).toBe(false);
  });

  it('still requires a password', async () => {
    expect((await validate({ identifier: 'ana-7kq4m9tx' })).ok).toBe(false);
    expect(
      (await validate({ identifier: 'ana-7kq4m9tx', password: '' })).ok,
    ).toBe(false);
  });

  it('rejects a non-string identifier (object / number)', async () => {
    expect(
      (await validate({ identifier: { $ne: '' }, password: 'p' })).ok,
    ).toBe(false);
    expect((await validate({ identifier: 12345678, password: 'p' })).ok).toBe(
      false,
    );
  });
});
