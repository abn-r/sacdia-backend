import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateAnnualRankingComponentConfigDto } from './create-annual-ranking-config.dto';

export class UpdateAnnualRankingConfigDto {
  @ApiProperty({
    description:
      'Annual maximum points configured by local field + year + club type',
    example: 12000,
  })
  @IsInt()
  @Min(1)
  max_points!: number;

  @ApiProperty({ type: [CreateAnnualRankingComponentConfigDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateAnnualRankingComponentConfigDto)
  components!: CreateAnnualRankingComponentConfigDto[];
}
