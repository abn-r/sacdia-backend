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
  declare allergy_ids: number[];
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
  declare disease_ids: number[];
}

export class UpdateUserMedicinesDto {
  @ApiProperty({
    example: [3, 7],
    description: 'Lista de IDs de medicamentos activos para el usuario',
    type: [Number],
  })
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  declare medicine_ids: number[];
}
