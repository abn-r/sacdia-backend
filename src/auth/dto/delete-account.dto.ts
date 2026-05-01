import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class DeleteAccountDto {
  /**
   * Current password — used to re-authenticate the user before destructive action.
   * Prevents session-hijacking attacks where an attacker with a stolen token
   * deletes the account without knowing the credentials.
   */
  @ApiProperty({
    description:
      'Contraseña actual del usuario para confirmar la eliminación de cuenta',
    example: 'MyPassword123!',
  })
  @IsString()
  @IsNotEmpty({
    message: 'La contraseña es requerida para confirmar la eliminación',
  })
  @MinLength(1)
  password!: string;
}
