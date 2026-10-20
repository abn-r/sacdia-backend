import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { LEGAL_VERSION_MAX_LENGTH } from '../legal-documents.constants';
import { trimLegalVersion } from './legal-version.transform';

export class AcceptLegalDocumentsDto {
  @ApiProperty({
    example: '2.0.0-family',
    description: 'Versión de los Términos y Condiciones que se acepta',
  })
  @Transform(trimLegalVersion)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEGAL_VERSION_MAX_LENGTH)
  declare terms_version: string;

  @ApiProperty({
    example: '2.0.0-family',
    description: 'Versión del Aviso de Privacidad que se acepta',
  })
  @Transform(trimLegalVersion)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEGAL_VERSION_MAX_LENGTH)
  declare privacy_version: string;
}
