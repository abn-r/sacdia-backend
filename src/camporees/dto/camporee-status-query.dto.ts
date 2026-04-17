import { IsOptional, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for filtering camporee enrollment list endpoints by status
 */
export class CamporeeStatusQueryDto {
  @ApiPropertyOptional({
    description: 'Filtrar por estado de inscripción',
    example: 'approved',
    enum: [
      'registered',
      'pending_approval',
      'approved',
      'rejected',
      'cancelled',
    ],
  })
  @IsOptional()
  @IsIn(['registered', 'pending_approval', 'approved', 'rejected', 'cancelled'])
  status?: string;
}
