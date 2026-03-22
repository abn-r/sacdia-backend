import { IsBoolean, IsDateString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateInvestitureConfigDto {
  @ApiPropertyOptional({
    description: 'Fecha límite de envío a validación (YYYY-MM-DD)',
    example: '2026-05-20',
  })
  @IsOptional()
  @IsDateString()
  submission_deadline?: string;

  @ApiPropertyOptional({
    description: 'Fecha de la ceremonia de investidura (YYYY-MM-DD)',
    example: '2026-06-10',
  })
  @IsOptional()
  @IsDateString()
  investiture_date?: string;

  @ApiPropertyOptional({
    description: 'Estado activo de la configuración',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
