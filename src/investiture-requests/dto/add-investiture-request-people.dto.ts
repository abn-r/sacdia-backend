import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsString,
  Matches,
} from 'class-validator';

export class AddInvestitureRequestPeopleDto {
  @ApiProperty({ example: '2026-11-15' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  investiture_date!: string;

  @ApiProperty({ type: [Number], example: [902] })
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  enrollment_ids!: number[];
}
