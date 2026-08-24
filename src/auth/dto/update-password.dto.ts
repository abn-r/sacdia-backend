import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { IsNewPassword } from '../password-policy';

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

  @IsNewPassword({ example: 'NewPassword123!' })
  password!: string;
}
