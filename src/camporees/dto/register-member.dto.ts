import {
  IsString,
  IsInt,
  IsOptional,
  IsIn,
  IsNotEmpty,
  IsUUID,
  Min,
} from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for registering a member in a camporee
 * Supports both local and union-level registrations with mandatory insurance.
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
  @MaxLengthIfString(50)
  camporee_type?: 'local' | 'union';

  @ApiPropertyOptional({
    description: 'Nombre del club (requerido para registros de nivel unión)',
    example: 'Club Conquistadores Central',
  })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(255)
  club_name?: string;

  @ApiProperty({
    description: 'ID del seguro del miembro (referencia a member_insurances)',
    example: 123,
  })
  @IsInt()
  @Min(1)
  declare insurance_id: number;
}
