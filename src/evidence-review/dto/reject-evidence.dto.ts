import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectEvidenceDto {
  @ApiProperty({
    description: 'Motivo del rechazo (obligatorio)',
    minLength: 1,
    maxLength: 1000,
    example: 'La imagen no es legible. Por favor sube una foto más clara.',
  })
  @IsString()
  @MinLength(1, { message: 'El motivo de rechazo es obligatorio' })
  @MaxLength(1000, { message: 'Máximo 1000 caracteres' })
  reason: string;
}
