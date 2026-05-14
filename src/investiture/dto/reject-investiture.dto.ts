import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';

export class RejectInvestitureDto {
  @ApiProperty({
    description: 'Motivo del rechazo (obligatorio)',
    maxLength: 1000,
    example: 'Faltan evidencias del honor de Primeros Auxilios.',
  })
  @IsString()
  @IsNotEmpty({
    message: i18nValidationMessage('errors.VALIDATION.reject_reason_required'),
  })
  @MaxLength(1000, {
    message: i18nValidationMessage(
      'errors.VALIDATION.reject_reason_max_length',
      { max: 1000 },
    ),
  })
  declare reason: string;
}
