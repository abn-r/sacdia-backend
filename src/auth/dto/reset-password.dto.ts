import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { IsNewPassword } from '../password-policy';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Token de recuperacion recibido en el enlace del correo',
    example: 'aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ3',
    maxLength: 512,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLengthIfString(512)
  declare token: string;

  @IsNewPassword({ example: 'NewPassword123!' })
  declare password: string;
}
