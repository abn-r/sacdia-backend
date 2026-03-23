import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({
    description: 'Token de verificación de email recibido por correo',
    example: 'aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ3',
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}
