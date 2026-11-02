import { IsOptional, IsString } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RejectRequestDto {
  @ApiPropertyOptional({
    description: 'Motivo del rechazo',
    example: 'No se pudo verificar la identidad del solicitante',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(500)
  reason?: string;
}
