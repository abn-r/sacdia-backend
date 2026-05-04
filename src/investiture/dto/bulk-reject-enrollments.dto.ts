import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  ArrayNotEmpty,
  ArrayMaxSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BulkRejectEnrollmentsDto {
  @ApiProperty({
    description: 'IDs de los enrollments a rechazar',
    type: [Number],
    example: [1, 2, 3],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'enrollmentIds no puede estar vacío' })
  @ArrayMaxSize(200, {
    message: 'Se pueden rechazar un máximo de 200 enrollments a la vez',
  })
  @IsInt({ each: true })
  @Min(1, { each: true })
  declare enrollmentIds: number[];

  @ApiProperty({
    description: 'Motivo del rechazo (obligatorio para operaciones en bloque)',
    maxLength: 1000,
    example: 'Documentación incompleta revisada en sesión de coordinación.',
  })
  @IsString()
  @IsNotEmpty({ message: 'El motivo del rechazo es obligatorio' })
  @MaxLength(1000)
  declare comments: string;
}
