import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class BackfillCoordinatorAssignmentsDto {
  @ApiPropertyOptional({
    description:
      'Si es true, solo calcula candidatos y no escribe asignaciones. Default true.',
    default: true,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  dry_run?: boolean;
}
