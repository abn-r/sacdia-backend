import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectInvestitureDto {
  @ApiProperty({
    description: 'Motivo del rechazo (obligatorio)',
    maxLength: 1000,
    example: 'Faltan evidencias del honor de Primeros Auxilios.',
  })
  @IsString()
  @IsNotEmpty({ message: 'El motivo del rechazo es obligatorio' })
  @MaxLength(1000)
  declare reason: string;
}
