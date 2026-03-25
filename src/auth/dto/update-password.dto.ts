import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class UpdatePasswordDto {
  @ApiProperty({
    description: 'Nueva contraseña del usuario autenticado',
    minLength: 8,
    example: 'NewPassword123!',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
