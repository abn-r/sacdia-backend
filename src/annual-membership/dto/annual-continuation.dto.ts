import {
  IsArray,
  IsUUID,
  ArrayMinSize,
  ArrayMaxSize,
  IsOptional,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class AnnualContinuationBodyDto {
  @ApiProperty({
    description: 'Array of user UUIDs to continue in the current year',
    type: [String],
    minItems: 1,
    maxItems: 100,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  user_ids!: string[];
}

export class AnnualEnrollBodyDto {
  @ApiProperty({
    description: 'Optional target club section ID (must be in the same club as the ghost assignment)',
    required: false,
    type: Number,
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  club_section_id?: number;
}
