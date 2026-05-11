import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ArrayNotEmpty,
  ArrayMaxSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type EvidenceType = 'class' | 'honor';

export class BulkApproveEvidenceDto {
  @ApiProperty({
    description: 'IDs de los registros de evidencia a aprobar',
    type: [Number],
    example: [1, 2, 3],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'ids no puede estar vacío' })
  @ArrayMaxSize(200, {
    message: 'Se pueden aprobar un máximo de 200 registros a la vez',
  })
  @IsInt({ each: true })
  @Min(1, { each: true })
  declare ids: number[];

  @ApiProperty({
    description: 'Tipo de evidencia a aprobar en bloque',
    enum: ['class', 'honor'],
    example: 'class',
  })
  @IsEnum(['class', 'honor'], {
    message: 'type debe ser uno de: class, honor',
  })
  declare type: EvidenceType;

  @ApiPropertyOptional({
    description: 'Comentario opcional del aprobador',
    maxLength: 500,
    example: 'Aprobados en revisión de bloque.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comments?: string;
}
