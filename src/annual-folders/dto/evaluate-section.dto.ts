import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EvaluateSectionDto {
  @ApiProperty({
    description: 'Puntos obtenidos por la sección',
    example: 85,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  declare earned_points: number;

  @ApiPropertyOptional({
    description: 'Notas del evaluador sobre esta sección',
    example: 'Documentación completa y bien organizada',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
