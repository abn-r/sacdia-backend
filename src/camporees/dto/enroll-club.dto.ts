import { IsInt, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for enrolling a club section in a camporee
 */
export class EnrollClubDto {
  @ApiProperty({
    description: 'ID de la sección del club a inscribir',
    example: 1,
  })
  @IsInt()
  @IsNotEmpty()
  declare club_section_id: number;
}
