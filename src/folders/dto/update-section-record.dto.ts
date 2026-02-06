import { IsInt, IsPositive, IsObject, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSectionRecordDto {
  @ApiProperty({
    description:
      'Puntos obtenidos en la sección (máximo definido en el template)',
    example: 10,
  })
  @IsInt()
  @Min(0)
  points: number;

  @ApiProperty({
    description: 'Evidencias en formato JSON flexible',
    example: {
      photos: ['url1.jpg', 'url2.jpg'],
      description: 'Completó la actividad exitosamente',
      verified_by: 'Director Juan Pérez',
      date: '2026-02-10',
    },
  })
  @IsObject()
  evidences: Record<string, any>;
}
