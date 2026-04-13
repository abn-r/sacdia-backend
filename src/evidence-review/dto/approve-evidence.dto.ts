import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ApproveEvidenceDto {
  @ApiPropertyOptional({
    description: 'Comentario opcional del aprobador',
    maxLength: 500,
    example: 'Evidencia revisada y aprobada.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comments?: string;
}
