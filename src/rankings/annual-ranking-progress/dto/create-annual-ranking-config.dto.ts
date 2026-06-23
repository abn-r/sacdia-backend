import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAnnualRankingComponentConfigDto {
  @ApiProperty({
    description:
      'Stable canonical component key, e.g. annual_evidence_folder, finance_compliance, camporee_events',
    example: 'annual_evidence_folder',
  })
  @IsString()
  @MaxLength(50)
  component_key!: string;

  @ApiProperty({
    description: 'Human-readable component label',
    example: 'Carpeta Anual de Evidencias',
  })
  @IsString()
  @MaxLength(120)
  label!: string;

  @ApiProperty({
    description: 'Maximum points budget for this component',
    example: 6000,
  })
  @IsInt()
  @Min(1)
  max_points!: number;

  @ApiProperty({
    description: 'Display order',
    example: 1,
    default: 0,
  })
  @IsInt()
  @Min(0)
  sort_order?: number = 0;
}

export class CreateAnnualRankingAxisConfigDto {
  @ApiProperty({
    description: 'Stable axis key, e.g. administrative or operational',
    example: 'administrative',
  })
  @IsString()
  @MaxLength(50)
  axis_key!: string;

  @ApiProperty({
    description: 'Human-readable axis label',
    example: 'Cumplimiento Administrativo',
  })
  @IsString()
  @MaxLength(120)
  label!: string;

  @ApiProperty({
    description: 'Maximum points budget for this axis',
    example: 5000,
  })
  @IsInt()
  @Min(1)
  max_points!: number;

  @ApiProperty({
    description: 'Display order',
    example: 1,
    default: 0,
  })
  @IsInt()
  @Min(0)
  sort_order?: number = 0;

  @ApiProperty({ type: [CreateAnnualRankingComponentConfigDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateAnnualRankingComponentConfigDto)
  components!: CreateAnnualRankingComponentConfigDto[];
}

export class CreateAnnualRankingConfigDto {
  @ApiProperty({
    required: false,
    description:
      'Union scope owner. Exclusive with local_field_id. Union scope has precedence over local-field scope.',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  union_id?: number;

  @ApiProperty({
    required: false,
    description:
      'Local field scope owner. Exclusive with union_id and only allowed when no parent union config exists.',
    example: 4,
  })
  @ValidateIf((dto: CreateAnnualRankingConfigDto) => dto.union_id == null)
  @IsInt()
  @Min(1)
  local_field_id?: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  ecclesiastical_year_id!: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  club_type_id!: number;

  @ApiProperty({
    description:
      'Annual maximum points configured by hierarchy scope + year + club type',
    example: 10000,
  })
  @IsInt()
  @Min(1)
  max_points!: number;

  @ApiProperty({
    type: [CreateAnnualRankingAxisConfigDto],
    required: false,
    description:
      'Preferred axis-based ranking budget. New writes should use this shape.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateAnnualRankingAxisConfigDto)
  axes?: CreateAnnualRankingAxisConfigDto[];

  @ApiProperty({
    type: [CreateAnnualRankingComponentConfigDto],
    required: false,
    description:
      'Legacy flat component budget. Accepted for backwards compatibility and normalized to axes.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateAnnualRankingComponentConfigDto)
  components?: CreateAnnualRankingComponentConfigDto[];
}
