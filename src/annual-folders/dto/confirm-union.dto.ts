import { IsEnum, IsOptional, IsString } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { union_evaluation_decision_enum } from '@prisma/client';

export class ConfirmUnionDto {
  @ApiProperty({
    enum: union_evaluation_decision_enum,
    description: 'Union decision',
    example: union_evaluation_decision_enum.APPROVED,
  })
  @IsEnum(union_evaluation_decision_enum)
  declare decision: union_evaluation_decision_enum;

  @ApiPropertyOptional({
    description: 'Optional override/confirmation note',
    example: 'Revisado y aprobado por la unión',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(500)
  notes?: string;
}
