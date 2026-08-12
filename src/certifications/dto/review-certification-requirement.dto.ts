import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveCertificationRequirementDto {
  @ApiProperty({
    description:
      'Versión de bloqueo optimista de la inscripción (users_certifications.lock_version)',
    example: 0,
  })
  @IsInt()
  declare lock_version: number;

  @ApiPropertyOptional({
    description: 'Comentario opcional del revisor',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class RequestCertificationRequirementChangesDto {
  @ApiProperty({
    description:
      'Versión de bloqueo optimista de la inscripción (users_certifications.lock_version)',
    example: 0,
  })
  @IsInt()
  declare lock_version: number;

  @ApiProperty({
    description: 'Comentario obligatorio explicando qué se debe corregir',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  declare comment: string;
}
