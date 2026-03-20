import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MarkInvestidoDto {
  @ApiPropertyOptional({
    description: 'Comentario opcional del acto de investidura',
    maxLength: 500,
    example: 'Investidura realizada en el campamento de primavera 2026.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comments?: string;
}
