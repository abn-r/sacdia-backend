import { IsInt, IsPositive, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCertificationProgressDto {
  @ApiProperty({
    description: 'ID del módulo de la certificación',
    example: 1,
  })
  @IsInt()
  @IsPositive()
  declare module_id: number;

  @ApiProperty({
    description: 'ID de la sección del módulo',
    example: 1,
  })
  @IsInt()
  @IsPositive()
  declare section_id: number;

  @ApiProperty({
    description: 'Estado de completado de la sección',
    example: true,
  })
  @IsBoolean()
  declare completed: boolean;
}
