import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAnnualRankingComponentConfigDto {
  @ApiProperty({
    description:
      'Stable component key, e.g. annual_folder, finance, camporee, evidence',
    example: 'annual_folder',
  })
  @IsString()
  @MaxLength(50)
  component_key!: string;

  @ApiProperty({
    description: 'Human-readable component label',
    example: 'Carpeta anual',
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

export class CreateAnnualRankingConfigDto {
  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  local_field_id!: number;

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
      'Annual maximum points configured by local field + year + club type',
    example: 10000,
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
