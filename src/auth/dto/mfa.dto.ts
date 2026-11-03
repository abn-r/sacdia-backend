import { IsString, Length } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { ApiProperty } from '@nestjs/swagger';

export class EnrollMfaDto {
  @ApiProperty({
    example: 'mySecretPassword123',
    description:
      'Contraseña actual del usuario. Requerida para habilitar 2FA (evita enrolamiento no autorizado).',
  })
  @IsString()
  @MaxLengthIfString(128)
  declare password: string;
}

export class VerifyMfaDto {
  @ApiProperty({
    example: '123456',
    description:
      'Código TOTP de 6 dígitos de tu app de autenticación (Google Authenticator, Authy, etc.)',
  })
  @IsString()
  @Length(6, 6, { message: 'El código debe tener exactamente 6 dígitos' })
  declare code: string;
}

export class DisableMfaDto {
  @ApiProperty({
    example: 'mySecretPassword123',
    description:
      'Contraseña actual del usuario. Requerida para deshabilitar 2FA (previene desactivación no autorizada).',
  })
  @IsString()
  @MaxLengthIfString(128)
  declare password: string;
}
