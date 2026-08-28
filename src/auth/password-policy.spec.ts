import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminSetPasswordDto } from '../admin/dto/admin-auth.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { NEW_PASSWORD_MIN_LENGTH } from './password-policy';

const COMPLEX_12 = 'Password123!';
const COMPLEX_8 = 'Pass1!ab';
const LONG_NO_SPECIAL = 'Password1234';

describe('new password policy', () => {
  it('is 12 characters', () => {
    expect(NEW_PASSWORD_MIN_LENGTH).toBe(12);
    expect(COMPLEX_12).toHaveLength(12);
    expect(COMPLEX_8).toHaveLength(8);
  });

  it('rejects an 8-char complex password on register', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Juan',
      paternal_last_name: 'Garcia',
      maternal_last_name: 'Lopez',
      email: 'juan.garcia@example.com',
      password: COMPLEX_8,
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'password')).toBe(true);
  });

  it('accepts a 12-char complex password on register', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Juan',
      paternal_last_name: 'Garcia',
      maternal_last_name: 'Lopez',
      email: 'juan.garcia@example.com',
      password: COMPLEX_12,
    });
    const errors = await validate(dto);
    expect(errors.filter((error) => error.property === 'password')).toHaveLength(
      0,
    );
  });

  it('rejects a 12-char password without a special character', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Juan',
      paternal_last_name: 'Garcia',
      maternal_last_name: 'Lopez',
      email: 'juan.garcia@example.com',
      password: LONG_NO_SPECIAL,
    });
    const errors = await validate(dto);
    const passwordError = errors.find((error) => error.property === 'password');
    expect(passwordError?.constraints).toHaveProperty('matches');
  });

  it('applies the same floor to reset, update, and admin set', async () => {
    const reset = plainToInstance(ResetPasswordDto, {
      token: 'a'.repeat(32),
      password: COMPLEX_8,
    });
    const update = plainToInstance(UpdatePasswordDto, {
      currentPassword: COMPLEX_8,
      password: COMPLEX_8,
    });
    const admin = plainToInstance(AdminSetPasswordDto, {
      newPassword: COMPLEX_8,
    });

    const [resetErrors, updateErrors, adminErrors] = await Promise.all([
      validate(reset),
      validate(update),
      validate(admin),
    ]);

    expect(resetErrors.some((error) => error.property === 'password')).toBe(
      true,
    );
    expect(updateErrors.some((error) => error.property === 'password')).toBe(
      true,
    );
    expect(updateErrors.some((error) => error.property === 'currentPassword'))
      .toBe(false);
    expect(adminErrors.some((error) => error.property === 'newPassword')).toBe(
      true,
    );
  });
});
