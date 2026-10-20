import {
  IsEmail,
  IsString,
  Length,
  MaxLength,
  IsNotEmpty,
  MinLength,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  type ValidationArguments,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';

/** Both `identifier` and the legacy `email` at once is ambiguous: 400. */
@ValidatorConstraint({ name: 'noEmailWithIdentifier', async: false })
class NoEmailWithIdentifier implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    return (args.object as LoginDto).email === undefined;
  }

  defaultMessage(): string {
    return 'Send either identifier or email, not both';
  }
}

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Login body. `identifier` is an email (contains '@') or a login handle; the
 * legacy `email` field keeps working for old app builds. Exactly one of the two
 * must be present. The length bound runs here, before any database read.
 */
export class LoginDto {
  @ApiPropertyOptional({
    example: 'ana-7kq4m9tx',
    description:
      'Correo electrónico o usuario (handle). Con "@" es un correo; si no, un handle (sin distinguir mayúsculas).',
    minLength: 3,
    maxLength: 254,
  })
  @ValidateIf(
    (login: LoginDto) =>
      login.identifier !== undefined || login.email === undefined,
  )
  @Transform(trim)
  @IsString()
  @Length(3, 254)
  @Validate(NoEmailWithIdentifier)
  declare identifier?: string;

  @ApiPropertyOptional({
    example: 'juan.garcia@example.com',
    description:
      'Legado: correo electrónico. Use `identifier` en builds nuevas.',
    deprecated: true,
  })
  @ValidateIf((login: LoginDto) => login.email !== undefined)
  @Transform(trim)
  @IsEmail()
  declare email?: string;

  @ApiProperty({ example: 'Password123!', description: 'Contraseña' })
  @IsNotEmpty({
    message: i18nValidationMessage('errors.VALIDATION.password_required'),
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  declare password: string;
}

/**
 * The identifier the rest of the pipeline works with: the trimmed value of
 * `identifier`, else the legacy `email`.
 */
export function loginIdentifierOf(dto: LoginDto): string {
  return (dto.identifier ?? dto.email ?? '').trim();
}
