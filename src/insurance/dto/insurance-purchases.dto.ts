import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class SubmitInsurancePurchaseDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  insurance_cycle_config_id!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  total_amount!: number;

  @IsDateString()
  receipt_date!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  external_reference!: string;
}

export class RejectInsurancePurchaseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
