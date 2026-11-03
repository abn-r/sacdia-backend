import { IsString, IsNotEmpty } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSystemConfigDto {
  @ApiProperty({
    description: 'Nuevo valor para la configuracion del sistema',
    example: '75',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLengthIfString(500)
  declare config_value: string;
}
