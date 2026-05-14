import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class UpdatePasswordDto {
  @ApiProperty({
    description: 'Contraseña actual del usuario autenticado',
    minLength: 8,
    example: 'CurrentPassword123!',
  })
  @IsString()
  @MinLength(8, {
    message: i18nValidationMessage('errors.VALIDATION.password_min_length', {
      min: 8,
    }),
  })
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({
    description:
      'Nueva contraseña del usuario autenticado (mínimo 8 caracteres, debe incluir mayúscula, minúscula, número y carácter especial)',
    minLength: 8,
    example: 'NewPassword123!',
  })
  @IsString()
  @MinLength(8, {
    message: i18nValidationMessage('errors.VALIDATION.password_min_length', {
      min: 8,
    }),
  })
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message: i18nValidationMessage('errors.VALIDATION.password_format'),
  })
  password!: string;
}
