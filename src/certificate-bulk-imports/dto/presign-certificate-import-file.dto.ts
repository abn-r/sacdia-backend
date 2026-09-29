import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  CERTIFICATE_IMPORT_ALLOWED_MIME_TYPES,
  CERTIFICATE_IMPORT_MAX_BYTES,
} from '../certificate-import-files.constants';

export class PresignCertificateImportFileDto {
  @ApiProperty({ maxLength: 255, example: 'certificado.pdf' })
  @IsString()
  @MaxLength(255)
  declare file_name: string;

  @ApiProperty({ enum: CERTIFICATE_IMPORT_ALLOWED_MIME_TYPES })
  @IsIn(CERTIFICATE_IMPORT_ALLOWED_MIME_TYPES)
  declare mime_type: string;

  @ApiProperty({ minimum: 1, maximum: CERTIFICATE_IMPORT_MAX_BYTES })
  @IsInt()
  @Min(1)
  @Max(CERTIFICATE_IMPORT_MAX_BYTES)
  declare file_size: number;
}
