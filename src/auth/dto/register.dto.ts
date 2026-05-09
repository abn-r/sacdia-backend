import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';

export class RegisterDto {
  @ApiProperty({ example: 'Juan', description: 'Nombre del usuario' })
  @IsString()
  @MaxLength(50)
  declare name: string;

  @ApiProperty({ example: 'García', description: 'Apellido paterno' })
  @IsString()
  @MaxLength(50)
  declare paternal_last_name: string;

  @ApiProperty({ example: 'López', description: 'Apellido materno' })
  @IsString()
  @MaxLength(50)
  declare maternal_last_name: string;

  @ApiProperty({
    example: 'juan.garcia@example.com',
    description: 'Correo electrónico',
  })
  @IsEmail()
  declare email: string;

  @ApiProperty({
    example: 'Password123!',
    description:
      'Contraseña segura (mínimo 8 caracteres, debe incluir mayúscula, minúscula, número y carácter especial)',
  })
  @IsString()
  @MinLength(8, { message: i18nValidationMessage('errors.VALIDATION.password_min_length', { min: 8 }) })
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message: i18nValidationMessage('errors.VALIDATION.password_format'),
  })
  declare password: string;
}
