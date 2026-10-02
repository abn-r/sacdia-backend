import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsString,
  Matches,
} from 'class-validator';

export class PresentInvestitureRequestDto {
  @ApiProperty({ example: 2026 })
  @IsInt()
  ecclesiastical_year_id!: number;

  @ApiProperty({ example: '2026-11-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  investiture_date!: string;

  @ApiProperty({ type: [Number], example: [901] })
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  enrollment_ids!: number[];
}
