import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClubEnrollmentDto {
  @ApiPropertyOptional({
    example: 'Av. Insurgentes 123, Col. Centro',
    description: 'Dirección de reunión del club para este año',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({
    example: 'Sábados y Domingos',
    description: 'Días de reunión del club para este año',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  meeting_days?: string;
}
