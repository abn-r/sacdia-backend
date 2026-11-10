import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export const ROLE_REQUIREMENT_MODES = ['INFO', 'WARN', 'BLOCK'] as const;
export type RoleRequirementModeName = (typeof ROLE_REQUIREMENT_MODES)[number];

export class UpdateRoleRequirementDto {
  @ApiPropertyOptional({ enum: ROLE_REQUIREMENT_MODES })
  @IsOptional()
  @IsIn(ROLE_REQUIREMENT_MODES)
  mode?: RoleRequirementModeName;

  @ApiPropertyOptional({
    nullable: true,
    example: '2027-01-01',
    description: 'YYYY-MM-DD; null quita la fecha (rige desde ya).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effective_from?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Certificación que equivale a la constancia; null la quita.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  equivalent_certification_id?: number | null;
}
