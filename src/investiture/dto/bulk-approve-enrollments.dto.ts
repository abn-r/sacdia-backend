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

export type BulkApproveAction =
  | 'club-approve'
  | 'coordinator-approve'
  | 'field-approve'
  | 'invest';

export class BulkApproveEnrollmentsDto {
  @ApiProperty({
    description: 'IDs de los enrollments a aprobar',
    type: [Number],
    example: [1, 2, 3],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'enrollmentIds no puede estar vacío' })
  @ArrayMaxSize(200, { message: 'Se pueden aprobar un máximo de 200 enrollments a la vez' })
  @IsInt({ each: true })
  @Min(1, { each: true })
  enrollmentIds: number[];

  @ApiProperty({
    description: 'Acción de aprobación a aplicar',
    enum: ['club-approve', 'coordinator-approve', 'field-approve', 'invest'],
    example: 'coordinator-approve',
  })
  @IsEnum(['club-approve', 'coordinator-approve', 'field-approve', 'invest'], {
    message: 'action debe ser uno de: club-approve, coordinator-approve, field-approve, invest',
  })
  action: BulkApproveAction;

  @ApiPropertyOptional({
    description: 'Comentario opcional del aprobador',
    maxLength: 500,
    example: 'Revisados y aprobados en bloque.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comments?: string;
}
