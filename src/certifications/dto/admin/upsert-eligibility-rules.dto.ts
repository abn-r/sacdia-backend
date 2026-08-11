import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { certification_eligibility_rule_type_enum } from '@prisma/client';

export class UpsertEligibilityRuleDto {
  @ApiProperty({
    enum: certification_eligibility_rule_type_enum,
    example: certification_eligibility_rule_type_enum.MIN_AGE,
  })
  @IsEnum(certification_eligibility_rule_type_enum)
  rule_type!: certification_eligibility_rule_type_enum;

  @ApiPropertyOptional({
    description:
      'Configuración específica del tipo de regla (validada por tipo). Ej: { "min_age": 16 } para MIN_AGE.',
    example: { min_age: 16 },
  })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'class_id FK (requerido para INVESTED_CLASS)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  class_id?: number;

  @ApiPropertyOptional({
    description: 'club_type_id FK (requerido para ACTIVE_CLUB_TYPE)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  club_type_id?: number;

  @ApiPropertyOptional({
    description: 'role_id FK (requerido para ACTIVE_ROLE)',
  })
  @IsOptional()
  @IsUUID()
  role_id?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;
}

export class UpsertEligibilityRulesDto {
  @ApiProperty({
    type: [UpsertEligibilityRuleDto],
    description:
      'Lista completa de reglas de elegibilidad. Reemplaza las reglas existentes de la versión DRAFT.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertEligibilityRuleDto)
  rules!: UpsertEligibilityRuleDto[];
}
