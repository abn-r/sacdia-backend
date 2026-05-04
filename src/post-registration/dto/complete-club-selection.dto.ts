import { IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty({
    example: 1,
    description: 'ID de la clase a inscribirse',
  })
  @IsInt()
  declare class_id: number;
}
