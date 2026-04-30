import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsIn } from 'class-validator';

export class CreateDataExportDto {
  @ApiPropertyOptional({
    description: 'Export file format. Only "json" is supported.',
    enum: ['json'],
    default: 'json',
    example: 'json',
  })
  @IsOptional()
  @IsIn(['json'], { message: 'Only "json" format is supported' })
  format? = 'json' as const;
}
