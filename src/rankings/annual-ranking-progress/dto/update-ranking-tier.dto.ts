import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { MaxLengthIfString } from '../../../common/validation/max-length-if-string.decorator';

export class UpdateRankingTierDto {
  @ApiPropertyOptional({ example: 'Diamante' })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(100)
  name?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  band_percentage?: number;

  @ApiPropertyOptional({ example: '#94a3b8' })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(20)
  color?: string;

  @ApiPropertyOptional({ example: 'diamond' })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(100)
  icon?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
