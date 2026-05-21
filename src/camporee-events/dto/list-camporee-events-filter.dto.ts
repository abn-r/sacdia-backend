import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CamporeeEventStatusDto } from './camporee-events.dto';

export class ListCamporeeEventsFilterDto {
  @ApiPropertyOptional({ example: 2, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  day_number?: number;

  @ApiPropertyOptional({
    example: 'espiritual',
    enum: [
      'espiritual',
      'competencia',
      'taller',
      'ceremonial',
      'social',
      'logistico',
    ],
  })
  @IsOptional()
  @IsString()
  @IsIn([
    'espiritual',
    'competencia',
    'taller',
    'ceremonial',
    'social',
    'logistico',
  ])
  display_category?: string;

  @ApiPropertyOptional({
    example: 'adventurers',
    enum: ['adventurers', 'pathfinders', 'master_guides'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['adventurers', 'pathfinders', 'master_guides'])
  section?: string;

  @ApiPropertyOptional({ enum: CamporeeEventStatusDto })
  @IsOptional()
  @IsEnum(CamporeeEventStatusDto)
  status?: CamporeeEventStatusDto;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  venue_id?: number;

  @ApiPropertyOptional({ example: 'abc-123-uuid' })
  @IsOptional()
  @IsUUID()
  leader_user_id?: string;

  @ApiPropertyOptional({ example: 'nudos' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ example: 100, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 100;

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
