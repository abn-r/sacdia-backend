import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CreateAnnualRankingAxisConfigDto,
  CreateAnnualRankingComponentConfigDto,
} from './create-annual-ranking-config.dto';

export class UpdateAnnualRankingConfigDto {
  @ApiProperty({
    description:
      'Annual maximum points configured by local field + year + club type',
    example: 12000,
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
