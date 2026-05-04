import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export enum InsuranceType {
  GENERAL_ACTIVITIES = 'GENERAL_ACTIVITIES',
  CAMPOREE = 'CAMPOREE',
  HIGH_RISK = 'HIGH_RISK',
}

export class CreateInsuranceDto {
  @IsEnum(InsuranceType)
  declare insurance_type: InsuranceType;

  @IsDateString()
  declare start_date: string;

  @IsDateString()
  declare end_date: string;

  @IsOptional()
  @IsString()
  policy_number?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  coverage_amount?: number;

  @IsOptional()
  @IsBooleanString()
  active?: string;
}
