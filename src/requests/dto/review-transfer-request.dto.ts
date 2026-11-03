import { IsIn, IsOptional, IsString } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewTransferRequestDto {
  @ApiProperty({
    description: 'Acción a tomar sobre la solicitud',
    enum: ['approved', 'rejected'],
    example: 'approved',
  })
  @IsIn(['approved', 'rejected'])
  declare action: 'approved' | 'rejected';

  @ApiPropertyOptional({
    description: 'Comentario del revisor',
    example: 'Aprobado, bienvenido al nuevo club',
  })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(500)
  comment?: string;
}
