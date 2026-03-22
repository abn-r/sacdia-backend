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
  insurance_type: InsuranceType;

  @IsDateString()
  start_date: string;

  @IsDateString()
  end_date: string;

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
