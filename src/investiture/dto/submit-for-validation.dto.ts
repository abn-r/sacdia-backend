import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitForValidationDto {
  @ApiProperty({
    description:
      'ID del club desde el que se envía (requerido por ClubRolesGuard)',
    example: 1,
  })
  @IsInt()
  @IsPositive()
  declare club_id: number;

  @ApiPropertyOptional({
    description: 'Comentario opcional del consejero/director',
    maxLength: 500,
    example: 'El miembro completó todos los requisitos durante el campamento.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comments?: string;
}
