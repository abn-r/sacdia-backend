import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

/** New passwords only. Existing 8–11 char accounts can still login and rotate. */
export const NEW_PASSWORD_MIN_LENGTH = 12;
export const NEW_PASSWORD_MAX_LENGTH = 128;
export const NEW_PASSWORD_COMPLEXITY =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;

const DEFAULT_DESCRIPTION =
  'Contraseña (mínimo 12 caracteres, mayúscula, minúscula, número y carácter especial @$!%*?&)';

export function IsNewPassword(
  api: { description?: string; example?: string } = {},
): PropertyDecorator {
  return applyDecorators(
    ApiProperty({
      description: api.description ?? DEFAULT_DESCRIPTION,
      example: api.example ?? 'Password123!',
      minLength: NEW_PASSWORD_MIN_LENGTH,
      maxLength: NEW_PASSWORD_MAX_LENGTH,
    }),
    IsString(),
    MinLength(NEW_PASSWORD_MIN_LENGTH, {
      message: i18nValidationMessage('errors.VALIDATION.password_min_length', {
        min: NEW_PASSWORD_MIN_LENGTH,
      }),
    }),
    MaxLength(NEW_PASSWORD_MAX_LENGTH),
    Matches(NEW_PASSWORD_COMPLEXITY, {
      message: i18nValidationMessage('errors.VALIDATION.password_format'),
    }),
  );
}
