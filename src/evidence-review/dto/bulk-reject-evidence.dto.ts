import {
  IsArray,
  IsEnum,
  IsInt,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ArrayNotEmpty,
  ArrayMaxSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { EvidenceType } from './bulk-approve-evidence.dto';

export class BulkRejectEvidenceDto {
  @ApiProperty({
    description: 'IDs de los registros de evidencia a rechazar',
    type: [Number],
    example: [1, 2, 3],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'ids no puede estar vacío' })
  @ArrayMaxSize(200, { message: 'Se pueden rechazar un máximo de 200 registros a la vez' })
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids: number[];

  @ApiProperty({
    description: 'Tipo de evidencia a rechazar en bloque',
    enum: ['folder', 'class', 'honor'],
    example: 'class',
  })
  @IsEnum(['folder', 'class', 'honor'], {
    message: 'type debe ser uno de: folder, class, honor',
  })
  type: EvidenceType;

  @ApiProperty({
    description: 'Motivo del rechazo (obligatorio)',
    minLength: 1,
    maxLength: 1000,
    example: 'Imágenes borrosas. Por favor sube evidencia más clara.',
  })
  @IsString()
  @MinLength(1, { message: 'El motivo de rechazo es obligatorio' })
  @MaxLength(1000, { message: 'Máximo 1000 caracteres' })
  reason: string;
}
