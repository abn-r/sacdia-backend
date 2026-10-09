import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ReleaseLegacyLocksDto {
  @ApiPropertyOptional({
    default: true,
    description:
      'true (por defecto) solo lista candidatos; false suelta locked_for_validation',
  })
  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;
}
