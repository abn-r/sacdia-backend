import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class UpdatePasswordDto {
  @ApiProperty({
    description:
      'Nueva contraseña del usuario autenticado (mínimo 8 caracteres, debe incluir mayúscula, minúscula, número y carácter especial)',
    minLength: 8,
    example: 'NewPassword123!',
  })
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'La contraseña debe incluir: mayúscula, minúscula, número y carácter especial (@$!%*?&)',
  })
  password!: string;
}
