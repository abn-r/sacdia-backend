import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';

export class UpsertFieldPaymentOrderConfigDto {
  /** Optional for LF leadership (resolved from actor); required for global admins. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  local_field_id?: number;

  @IsOptional()
  @IsString()
  @MaxLengthIfString(255)
  bank_name?: string;

  @IsOptional()
  @IsString()
  @MaxLengthIfString(64)
  bank_account?: string;

  @IsOptional()
  @IsString()
  @MaxLengthIfString(32)
  bank_clabe?: string;

  @IsOptional()
  @IsString()
  @MaxLengthIfString(255)
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
