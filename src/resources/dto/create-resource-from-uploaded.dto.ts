import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PRESIGNED_UPLOAD_MAX_BYTES } from './generate-upload-url.dto';

/**
 * Payload for creating a resource whose file has already been uploaded to R2
 * via the presigned PUT flow. Server verifies the key exists on R2 before
 * persisting the DB row.
 */
export class CreateResourceFromUploadedDto {
  @ApiProperty({ description: 'Título del recurso', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  declare title: string;

  @ApiPropertyOptional({ description: 'Descripción del recurso' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Tipo de recurso (debe coincidir con el archivo subido)',
    enum: ['document', 'audio', 'image'],
  })
  @IsString()
  @IsIn(['document', 'audio', 'image'])
  declare resource_type: 'document' | 'audio' | 'image';

  @ApiPropertyOptional({ description: 'ID de categoría' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  resource_category_id?: number;

  @ApiPropertyOptional({ description: 'ID del tipo de club' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  club_type_id?: number;

  @ApiProperty({
    description: 'Nivel de alcance',
    enum: ['system', 'division', 'union', 'local_field'],
  })
  @IsString()
  @IsIn(['system', 'division', 'union', 'local_field'])
  declare scope_level: 'system' | 'division' | 'union' | 'local_field';

  @ApiPropertyOptional({ description: 'ID del ámbito' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  scope_id?: number;

  @ApiProperty({
    description:
      'Clave del objeto en R2 emitida por POST /resources/upload-url. ' +
      'Debe coincidir exactamente con la key devuelta por ese endpoint.',
    maxLength: 1024,
  })
  @IsString()
  @MaxLength(1024)
  @Matches(/^[\w./-]+$/, { message: 'file_key contiene caracteres inválidos' })
  declare file_key: string;

  @ApiProperty({ description: 'Nombre original del archivo', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  declare file_name: string;

  @ApiProperty({ description: 'MIME type del archivo', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(/^[\w.+-]+\/[\w.+-]+$/, { message: 'file_mime_type inválido' })
  declare file_mime_type: string;

  @ApiProperty({ description: 'Tamaño del archivo en bytes (informativo)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PRESIGNED_UPLOAD_MAX_BYTES)
  declare file_size: number;
}
