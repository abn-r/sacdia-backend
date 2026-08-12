import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertFieldPaymentOrderConfigDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  local_field_id!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  bank_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  bank_account?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  bank_clabe?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  bank_holder?: string;

  @IsOptional()
  @IsString()
  cash_instructions?: string;

  @IsOptional()
  @IsString()
  extra_notes?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class GetFieldPaymentOrderConfigQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  local_field_id?: number;
}
