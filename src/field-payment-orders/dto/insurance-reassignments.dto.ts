import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateInsuranceReassignmentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  insurance_assignment_id!: number;

  @IsUUID('4')
  to_user_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
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
