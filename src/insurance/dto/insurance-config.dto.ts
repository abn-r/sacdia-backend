import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Validate,
} from 'class-validator';
import { IsIanaTimezoneConstraint } from '../../common/validators/iana-timezone.validator';

export const INSURANCE_COVERAGE_SCOPES = ['GENERAL', 'EVENT'] as const;
export const INSURANCE_VALIDITY_MODES = [
  'FIXED_MONTHS',
  'EVENT_DATES',
] as const;

export type InsuranceCoverageScope = (typeof INSURANCE_COVERAGE_SCOPES)[number];
export type InsuranceValidityMode = (typeof INSURANCE_VALIDITY_MODES)[number];

export class CreateInsuranceProductDto {
  @ApiProperty({ example: 'Seguro anual' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  declare name: string;

  @ApiProperty({ enum: INSURANCE_COVERAGE_SCOPES })
  @IsIn(INSURANCE_COVERAGE_SCOPES)
  declare coverage_scope: InsuranceCoverageScope;

  @ApiProperty({ enum: INSURANCE_VALIDITY_MODES })
  @IsIn(INSURANCE_VALIDITY_MODES)
  declare validity_mode: InsuranceValidityMode;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  declare default_duration_months?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  declare active?: boolean;
}

export class UpdateInsuranceProductDto {
  @ApiPropertyOptional({ example: 'Seguro anual 2026' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  declare name?: string;

  @ApiPropertyOptional({ enum: INSURANCE_COVERAGE_SCOPES })
  @IsOptional()
  @IsIn(INSURANCE_COVERAGE_SCOPES)
  declare coverage_scope?: InsuranceCoverageScope;

  @ApiPropertyOptional({ enum: INSURANCE_VALIDITY_MODES })
  @IsOptional()
  @IsIn(INSURANCE_VALIDITY_MODES)
  declare validity_mode?: InsuranceValidityMode;

  @ApiPropertyOptional({ example: 12, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  declare default_duration_months?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare active?: boolean;
}

export class CreateInsuranceCycleDto {
  @ApiProperty({ example: 10 })
  @IsInt()
  declare insurance_product_id: number;

  @ApiProperty({ example: 2026 })
  @IsInt()
  declare ecclesiastical_year_id: number;

  @ApiProperty({ example: 3 })
  @IsInt()
  declare club_type_id: number;

  @ApiProperty({ example: 125.5 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  declare unit_cost: number;

  @ApiProperty({ example: '2026-03-31', format: 'date' })
  @IsDateString()
  declare purchase_deadline: string;

  @ApiProperty({ example: 'America/Mexico_City' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Validate(IsIanaTimezoneConstraint)
  declare timezone: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  declare active?: boolean;
}

export class UpdateInsuranceCycleDto {
  @ApiPropertyOptional({ example: 125.5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  declare unit_cost?: number;

  @ApiPropertyOptional({ example: '2026-03-31', format: 'date' })
  @IsOptional()
  @IsDateString()
  declare purchase_deadline?: string;

  @ApiPropertyOptional({ example: 'America/Mexico_City' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Validate(IsIanaTimezoneConstraint)
  declare timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare active?: boolean;
}
