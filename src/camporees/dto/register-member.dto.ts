import {
  IsString,
  IsInt,
  IsOptional,
  IsIn,
  IsNotEmpty,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for registering a member in a camporee
 * Supports both local and union-level registrations with optional insurance
 */
export class RegisterMemberDto {
  @ApiProperty({
    description: 'ID del usuario a registrar',
    example: 'user-uuid-here',
  })
  @IsUUID()
  @IsNotEmpty()
  declare user_id: string;

  @ApiPropertyOptional({
    description:
      'Tipo de camporee (deprecated). El backend lo infiere desde el endpoint local/unión.',
    example: 'local',
    enum: ['local', 'union'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['local', 'union'])
  @MaxLength(50)
  camporee_type?: 'local' | 'union';

  @ApiPropertyOptional({
    description: 'Nombre del club (requerido para registros de nivel unión)',
    example: 'Club Conquistadores Central',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  club_name?: string;

  @ApiPropertyOptional({
    description: 'ID del seguro del miembro (referencia a member_insurances)',
    example: 123,
  })
  @IsOptional()
  @IsInt()
  insurance_id?: number;
}
