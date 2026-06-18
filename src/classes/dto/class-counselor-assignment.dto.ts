import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const CLASS_COUNSELOR_RESPONSIBILITY_TYPES = [
  'primary',
  'assistant',
  'substitute',
] as const;

export type ClassCounselorResponsibilityType =
  (typeof CLASS_COUNSELOR_RESPONSIBILITY_TYPES)[number];

export class CreateClassCounselorAssignmentDto {
  @ApiProperty({ description: 'Usuario responsable de la clase' })
  @IsUUID()
  declare user_id: string;

  @ApiProperty({ description: 'Clase progresiva asignada' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare class_id: number;

  @ApiPropertyOptional({ description: 'Año eclesiástico' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ecclesiastical_year_id?: number;

  @ApiPropertyOptional({
    enum: CLASS_COUNSELOR_RESPONSIBILITY_TYPES,
    default: 'primary',
    description: 'Responsabilidad dentro de la clase',
  })
  @IsOptional()
  @IsIn(CLASS_COUNSELOR_RESPONSIBILITY_TYPES)
  responsibility_type?: ClassCounselorResponsibilityType;

  @ApiPropertyOptional({
    description:
      'Asignación excepcional, requerida cuando el usuario ya tiene otra clase',
  })
  @IsOptional()
  @IsBoolean()
  exceptional?: boolean;

  @ApiPropertyOptional({ description: 'Justificación de la excepción' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  exception_reason?: string;

  @ApiPropertyOptional({ description: 'Fecha de inicio de la asignación' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  start_date?: Date;

  @ApiPropertyOptional({ description: 'Fecha de fin de la asignación' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  end_date?: Date;
}

export class UpdateClassCounselorAssignmentDto {
  @ApiPropertyOptional({
    enum: CLASS_COUNSELOR_RESPONSIBILITY_TYPES,
    description: 'Responsabilidad dentro de la clase',
  })
  @IsOptional()
  @IsIn(CLASS_COUNSELOR_RESPONSIBILITY_TYPES)
  responsibility_type?: ClassCounselorResponsibilityType;

  @ApiPropertyOptional({
    description:
      'Marca la asignación como excepcional; requiere justificación cuando es true',
  })
  @IsOptional()
  @IsBoolean()
  exceptional?: boolean;

  @ApiPropertyOptional({ description: 'Justificación de la excepción' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  exception_reason?: string;

  @ApiPropertyOptional({ description: 'Fecha de inicio de la asignación' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  start_date?: Date;

  @ApiPropertyOptional({ description: 'Fecha de fin de la asignación' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  end_date?: Date;
}
