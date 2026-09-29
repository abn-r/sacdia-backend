import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateInstitutionalCertificateRequestDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare class_id: number;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  declare file_id: string;

  @ApiProperty({ example: '2008-07-07' })
  @IsDateString({ strict: true })
  declare completed_at: string;

  @ApiPropertyOptional({ enum: ['MANUAL', 'OCR'] })
  @IsOptional()
  @IsIn(['MANUAL', 'OCR'])
  source?: 'MANUAL' | 'OCR';
}
