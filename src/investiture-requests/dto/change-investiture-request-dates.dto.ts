import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class ChangeInvestitureRequestDatesDto {
  @ApiProperty({ example: '2026-11-20' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  investiture_date!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  person_ids!: string[];
}
