import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';

export class RequirementComponentResponseDto {
  @ApiProperty({
    description: 'ID del componente (certification_requirement_components)',
    example: 1,
  })
  @IsInt()
  @IsPositive()
  declare component_id: number;

  @ApiPropertyOptional({ description: 'Valor de texto (TEXT_RESPONSE)' })
  @IsOptional()
  @IsString()
  text_value?: string;

  @ApiPropertyOptional({ description: 'Confirmación (ATTESTATION)' })
  @IsOptional()
  @IsBoolean()
  attestation_confirmed?: boolean;

  @ApiPropertyOptional({
    description: 'ID de users_honors del usuario autenticado (LINKED_HONOR)',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  linked_user_honor_id?: number;

  @ApiPropertyOptional({
    description: 'ID de actividad del usuario autenticado (LINKED_ACTIVITY)',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  linked_activity_id?: number;
}

export class SaveRequirementDraftDto {
  @ApiProperty({
    type: [RequirementComponentResponseDto],
    description:
      'Respuestas parciales a los componentes de la sección. No es necesario enviar todos los componentes en cada guardado.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RequirementComponentResponseDto)
  declare responses: RequirementComponentResponseDto[];
}
