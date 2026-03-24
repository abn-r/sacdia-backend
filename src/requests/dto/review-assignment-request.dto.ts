import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewAssignmentRequestDto {
  @ApiProperty({
    description: 'Acción a tomar sobre la solicitud',
    enum: ['approved', 'rejected'],
    example: 'approved',
  })
  @IsEnum(['approved', 'rejected'], {
    message: 'action must be either "approved" or "rejected"',
  })
  action: 'approved' | 'rejected';

  @ApiPropertyOptional({
    description: 'Comentario del revisor',
    example: 'Aprobado, rol asignado',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
