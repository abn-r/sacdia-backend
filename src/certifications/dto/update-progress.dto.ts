import { IsInt, IsPositive, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProgressDto {
  @ApiProperty({
    description: 'ID del módulo de la certificación',
    example: 1,
  })
  @IsInt()
  @IsPositive()
  module_id: number;

  @ApiProperty({
    description: 'ID de la sección del módulo',
    example: 1,
  })
  @IsInt()
  @IsPositive()
  section_id: number;

  @ApiProperty({
    description: 'Estado de completado de la sección',
    example: true,
  })
  @IsBoolean()
  completed: boolean;
}
