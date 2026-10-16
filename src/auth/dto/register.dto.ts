import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
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
    example: '1.0.0-store',
    description:
      'Versión vigente de los Términos y Condiciones (GET /legal/current)',
  })
  @Transform(trimLegalVersion)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEGAL_VERSION_MAX_LENGTH)
  declare accepted_terms_version: string;

  @ApiProperty({
    example: '1.0.0-store',
    description: 'Versión vigente del Aviso de Privacidad (GET /legal/current)',
  })
  @Transform(trimLegalVersion)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEGAL_VERSION_MAX_LENGTH)
  declare accepted_privacy_version: string;
}
