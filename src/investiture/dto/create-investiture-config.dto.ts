import { IsInt, IsPositive, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateInvestitureConfigDto {
  @ApiProperty({
    description: 'ID del campo local',
    example: 3,
  })
  @IsInt()
  @IsPositive()
  declare local_field_id: number;

  @ApiProperty({
    description: 'ID del año eclesiástico',
    example: 2026,
  })
  @IsInt()
  @IsPositive()
  declare ecclesiastical_year_id: number;

  @ApiProperty({
    description: 'Fecha límite de envío a validación (YYYY-MM-DD)',
    example: '2026-05-15',
  })
  @IsDateString()
  declare submission_deadline: string;

  @ApiProperty({
    description: 'Fecha de la ceremonia de investidura (YYYY-MM-DD)',
    example: '2026-06-01',
  })
  @IsDateString()
  declare investiture_date: string;
}
