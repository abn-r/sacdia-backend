import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EnrollMfaDto {
  @ApiProperty({
    example: 'mySecretPassword123',
    description:
      'Contraseña actual del usuario. Better Auth requiere la contraseña para habilitar 2FA.',
  })
  @IsString()
  password: string;
}

export class VerifyMfaDto {
  @ApiProperty({
    example: '123456',
    description: 'Código TOTP de 6 dígitos de tu app de autenticación',
  })
  @IsString()
  @Length(6, 6, { message: 'El código debe tener 6 dígitos' })
  code: string;
}

export class DisableMfaDto {
  @ApiProperty({
    example: 'mySecretPassword123',
    description:
      'Contraseña actual del usuario. Better Auth requiere la contraseña para deshabilitar 2FA.',
  })
  @IsString()
  password: string;
}
