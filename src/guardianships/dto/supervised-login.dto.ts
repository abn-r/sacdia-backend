import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export const SUPERVISED_LOGIN_METHODS = ['handle', 'email'] as const;
export type SupervisedLoginMethod = (typeof SUPERVISED_LOGIN_METHODS)[number];

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The password length here is only a sanity bound against huge bodies: the
 * password POLICY (12+ chars, upper, lower, digit, special) is enforced by the
 * service so a weak password answers 422 SUPERVISED_LOGIN_PASSWORD_INVALID and
 * rolls everything back. The value is never logged or audited.
 */
export class EnableSupervisedLoginDto {
  @ApiProperty({
    enum: SUPERVISED_LOGIN_METHODS,
    description:
      '`handle`: the server generates the user name (the child has no email). `email`: the child logs in with this email.',
  })
  @IsIn([...SUPERVISED_LOGIN_METHODS])
  declare method: SupervisedLoginMethod;

  @ApiPropertyOptional({
    description: 'Required (and only allowed) with method `email`.',
    example: 'ana@example.com',
  })
  @ValidateIf((dto: EnableSupervisedLoginDto) => dto.method === 'email')
  @Transform(trim)
  @IsEmail()
  @MaxLength(100)
  declare email?: string;

  @ApiProperty({
    description:
      'Password chosen by the guardian (same policy as registration).',
  })
  @IsString()
  @Length(1, 128)
  declare password: string;
}

export class DisableSupervisedLoginDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  declare reason?: string;
}

export class ReactivateSupervisedLoginDto {
  @ApiPropertyOptional({
    description:
      'Handle logins require a NEW password (the old hash is replaced); email logins ignore it.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  declare password?: string;
}

export class SetSupervisedPasswordDto {
  @ApiPropertyOptional({
    description:
      'New password for a handle login. An email login does not take one: the child receives the standard reset email.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  declare password?: string;
}
