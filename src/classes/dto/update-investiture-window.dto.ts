import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class UpdateInvestitureWindowDto {
  @ApiProperty({ example: '2026-10-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  start_date!: string;

  @ApiProperty({ example: '2026-12-20' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  end_date!: string;
}
