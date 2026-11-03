import { IsString, MinLength } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { ApiProperty } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';

export class RejectEvidenceDto {
  @ApiProperty({
    description: 'Motivo del rechazo (obligatorio)',
    minLength: 1,
    maxLength: 1000,
    example: 'La imagen no es legible. Por favor sube una foto más clara.',
  })
  @IsString()
  @MinLength(1, {
    message: i18nValidationMessage('errors.VALIDATION.reject_reason_required'),
  })
  @MaxLengthIfString(1000, {
    message: i18nValidationMessage(
      'errors.VALIDATION.reject_reason_max_length',
      { max: 1000 },
    ),
  })
  declare reason: string;
}
