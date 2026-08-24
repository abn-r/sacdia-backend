import { IsEmail, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsNewPassword } from '../password-policy';

export class RegisterDto {
  @ApiProperty({ example: 'Juan', description: 'Nombre del usuario' })
  @IsString()
  @MaxLength(50)
  declare name: string;

  @ApiProperty({ example: 'García', description: 'Apellido paterno' })
  @IsString()
  @MaxLength(50)
  declare paternal_last_name: string;

  @ApiProperty({ example: 'López', description: 'Apellido materno' })
  @IsString()
  @MaxLength(50)
  declare maternal_last_name: string;

  @ApiProperty({
    example: 'juan.garcia@example.com',
    description: 'Correo electrónico',
  })
  @IsEmail()
  declare email: string;

  @IsNewPassword()
  declare password: string;
}
