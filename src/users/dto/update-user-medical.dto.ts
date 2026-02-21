import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsInt, Min } from 'class-validator';

export class UpdateUserAllergiesDto {
  @ApiProperty({
    example: [1, 2],
    description: 'Lista de IDs de alergias activas para el usuario',
    type: [Number],
  })
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  allergy_ids: number[];
}

export class UpdateUserDiseasesDto {
  @ApiProperty({
    example: [10, 12],
    description: 'Lista de IDs de enfermedades activas para el usuario',
    type: [Number],
  })
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  disease_ids: number[];
}
