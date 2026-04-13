import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RejectRequestDto {
  @ApiPropertyOptional({
    description: 'Motivo del rechazo',
    example: 'No se pudo verificar la identidad del solicitante',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
