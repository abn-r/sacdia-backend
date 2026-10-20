import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNewPassword } from '../password-policy';
import { LEGAL_VERSION_MAX_LENGTH } from '../../legal/legal-documents.constants';
import { trimLegalVersion } from '../../legal/dto/legal-version.transform';

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

  @IsNewPassword()
  declare password: string;

  @ApiProperty({
    example: '2.0.0-family',
    description:
      'Versión vigente de los Términos y Condiciones (GET /legal/current)',
  })
  @Transform(trimLegalVersion)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEGAL_VERSION_MAX_LENGTH)
  declare accepted_terms_version: string;

  @ApiProperty({
    example: '2.0.0-family',
    description: 'Versión vigente del Aviso de Privacidad (GET /legal/current)',
  })
  @Transform(trimLegalVersion)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEGAL_VERSION_MAX_LENGTH)
  declare accepted_privacy_version: string;

  @ApiPropertyOptional({
    example: '2005-04-02',
    description:
      'Fecha de nacimiento (YYYY-MM-DD). Si se envía y la edad es menor al mínimo del país (13 por defecto) el registro se rechaza con 422 AUTH_REGISTRATION_AGE_BELOW_MINIMUM. La app lo exige; la validación autoritativa es PATCH /users/:userId.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'birthday must be a YYYY-MM-DD date',
  })
  @IsISO8601({ strict: true }, { message: 'birthday must be a valid date' })
  birthday?: string;

  @ApiPropertyOptional({
    example: 1,
    description:
      'País (define la edad mínima de la cuenta). Solo se usa para validar la edad; si se omite aplica el valor por defecto (13).',
  })
  @IsOptional()
  @IsInt()
  country_id?: number;
}
