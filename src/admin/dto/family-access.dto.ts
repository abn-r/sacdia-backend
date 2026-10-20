import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export const ADMIN_FAMILY_ACCESS_REASON_MIN_LENGTH = 5;
export const ADMIN_FAMILY_ACCESS_REASON_MAX_LENGTH = 500;

/**
 * Body of the two admin actions on a minor's access (family profiles 3c,
 * FP3-66): disable the own login, revoke a paired device. The REASON is
 * mandatory and is stored ONLY in the audit row. No other key is accepted: an
 * admin cannot set, reset or read a password through these routes.
 */
export class AdminFamilyAccessReasonDto {
  @ApiProperty({
    minLength: ADMIN_FAMILY_ACCESS_REASON_MIN_LENGTH,
    maxLength: ADMIN_FAMILY_ACCESS_REASON_MAX_LENGTH,
    example: 'Solicitud escrita del tutor legal',
    description:
      'Why the admin cuts the access. Stored in the audit row, never shown to the child.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(ADMIN_FAMILY_ACCESS_REASON_MIN_LENGTH)
  @MaxLength(ADMIN_FAMILY_ACCESS_REASON_MAX_LENGTH)
  declare reason: string;
}
