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

/**
 * Maximum file size accepted by the presigned-PUT flow.
 * Aligned with the multipart limit (50 MB) for now, but the presigned path
 * can be bumped independently without touching Multer config.
 */
export const PRESIGNED_UPLOAD_MAX_BYTES = 500 * 1024 * 1024; // 500 MB

export class GenerateUploadUrlDto {
  @ApiProperty({
    description: 'Tipo de recurso que se va a subir',
    enum: ['document', 'audio', 'image'],
  })
  @IsString()
  @IsIn(['document', 'audio', 'image'])
  declare resource_type: 'document' | 'audio' | 'image';

  @ApiProperty({
    description: 'Nivel de alcance del recurso',
    enum: ['system', 'division', 'union', 'local_field'],
  })
  @IsString()
  @IsIn(['system', 'division', 'union', 'local_field'])
  declare scope_level: 'system' | 'division' | 'union' | 'local_field';

  @ApiPropertyOptional({
    description:
      'ID del ámbito (division_id, union_id o local_field_id). Requerido para scope_level !== system.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  scope_id?: number;

  @ApiProperty({
    description: 'Nombre original del archivo (solo se usa para extensión)',
    maxLength: 255,
  })
  @IsString()
  @MaxLength(255)
  declare file_name: string;

  @ApiProperty({ description: 'MIME type real del archivo', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(/^[\w.+-]+\/[\w.+-]+$/, { message: 'mime_type inválido' })
  declare mime_type: string;

  @ApiProperty({
    description: 'Tamaño del archivo en bytes. Validado contra el límite.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PRESIGNED_UPLOAD_MAX_BYTES)
  declare file_size: number;
}
