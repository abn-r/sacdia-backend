import { IsOptional, IsString } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ApproveEvidenceDto {
  @ApiPropertyOptional({
    description: 'Comentario opcional del aprobador',
    maxLength: 500,
    example: 'Evidencia revisada y aprobada.',
  })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(500)
  comments?: string;
}
