import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ApproveInvestitureDto {
  @ApiPropertyOptional({
    description: 'Comentario opcional del aprobador',
    maxLength: 500,
    example: 'Revisado y aprobado. Requisitos completos.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comments?: string;
}
