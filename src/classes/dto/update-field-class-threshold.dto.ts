import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateFieldClassThresholdDto {
  @ApiProperty({
    minimum: 0,
    maximum: 100,
    example: 80,
    description:
      'Porcentaje entero que un requisito debe alcanzar para contar, salvo VALIDATED o REJECTED.',
  })
  @IsInt()
  @Min(0)
  @Max(100)
  minimum_percent!: number;
}
