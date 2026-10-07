import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class InvestitureInvestDecisionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  person_id!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class InvestitureRejectDecisionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  person_id!: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class ResolveInvestitureRequestDto {
  @ApiPropertyOptional({ type: [InvestitureInvestDecisionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvestitureInvestDecisionDto)
  invest?: InvestitureInvestDecisionDto[];

  @ApiPropertyOptional({ type: [InvestitureRejectDecisionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvestitureRejectDecisionDto)
  reject?: InvestitureRejectDecisionDto[];
}
