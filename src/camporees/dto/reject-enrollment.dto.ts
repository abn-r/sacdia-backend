import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for rejecting a club enrollment in a camporee
 */
export class RejectEnrollmentDto {
  @ApiPropertyOptional({
    description: 'Motivo del rechazo de la inscripción',
    example: 'El club no cumple los requisitos mínimos de participación',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejection_reason?: string;
}
