import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';

export class CreateInsuranceReassignmentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  insurance_assignment_id!: number;

  @IsUUID('4')
  to_user_id!: string;

  @IsOptional()
  @IsString()
  @MaxLengthIfString(500)
  reason?: string;
}

export enum ReassignmentStatusFilter {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export class ListReassignmentsQueryDto {
  @IsOptional()
  @IsEnum(ReassignmentStatusFilter)
  status?: ReassignmentStatusFilter;
}
