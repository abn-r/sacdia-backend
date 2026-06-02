import { IsInt, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CompleteClubSelectionDto {
  @ApiProperty({ example: 1, description: 'ID del país' })
  @IsInt()
  declare country_id: number;

  @ApiProperty({ example: 1, description: 'ID de la unión' })
  @IsInt()
  declare union_id: number;

  @ApiProperty({ example: 1, description: 'ID del campo local' })
  @IsInt()
  declare local_field_id: number;

  @ApiProperty({
    example: 1,
    description: 'ID de la sección del club',
  })
  @IsInt()
  declare club_section_id: number;

  @ApiPropertyOptional({
    example: 1,
    description:
      'ID de la clase a inscribirse. Si se omite, el backend deriva la clase por edad al inicio del año eclesiástico y tipo de club seleccionado.',
  })
  @IsOptional()
  @IsInt()
  declare class_id?: number;
}
