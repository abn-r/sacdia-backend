import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';

export class CreateInsurancePaymentOrderDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  insurance_cycle_config_id!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  beneficiary_user_ids!: string[];
}

export class CreateCamporeePaymentOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  beneficiary_user_ids!: string[];
}

export class RejectPaymentOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLengthIfString(500)
  reason!: string;
}

export enum PaymentOrderPurposeFilter {
  INSURANCE = 'INSURANCE',
  CAMPOREE = 'CAMPOREE',
}

export enum PaymentOrderStatusFilter {
  ISSUED = 'ISSUED',
  PROOF_SUBMITTED = 'PROOF_SUBMITTED',
  APPROVED = 'APPROVED',
  PROOF_REJECTED = 'PROOF_REJECTED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export class ListPaymentOrdersQueryDto {
  @IsOptional()
  @IsEnum(PaymentOrderPurposeFilter)
  purpose?: PaymentOrderPurposeFilter;

  @IsOptional()
  @IsEnum(PaymentOrderStatusFilter)
  status?: PaymentOrderStatusFilter;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  camporee_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  union_camporee_id?: number;
}
