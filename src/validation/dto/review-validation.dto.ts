import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewValidationDto {
  @ApiProperty({
    description: 'Accion de revision',
    enum: ['approved', 'rejected'],
    example: 'approved',
  })
  @IsString()
  @IsIn(['approved', 'rejected'])
  declare action: 'approved' | 'rejected';

  @ApiPropertyOptional({
    description: 'Comentario de la revision (requerido si se rechaza)',
    example: 'Falta evidencia del requisito 3',
  })
  @IsOptional()
  @IsString()
  comment?: string;
}
