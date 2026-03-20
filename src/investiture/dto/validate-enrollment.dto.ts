import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum InvestitureValidationAction {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export class ValidateEnrollmentDto {
  @ApiProperty({
    enum: InvestitureValidationAction,
    description: 'Decisión de validación',
    example: InvestitureValidationAction.APPROVED,
  })
  @IsEnum(InvestitureValidationAction)
  @IsNotEmpty()
  action: InvestitureValidationAction;

  @ApiPropertyOptional({
    description: 'Comentarios del validador. Requerido si action=REJECTED',
    maxLength: 1000,
    example: 'Faltan evidencias del honor de Primeros Auxilios.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comments?: string;
}
