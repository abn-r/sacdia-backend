import { IsIn, IsOptional, IsString } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewAssignmentRequestDto {
  @ApiProperty({
    description: 'Acción a tomar sobre la solicitud',
    enum: ['approved', 'rejected'],
    example: 'approved',
  })
  @IsIn(['approved', 'rejected'])
  declare action: 'approved' | 'rejected';

  @ApiPropertyOptional({
    description: 'Comentario del revisor',
    example: 'Aprobado, rol asignado',
  })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(500)
  comment?: string;
}
