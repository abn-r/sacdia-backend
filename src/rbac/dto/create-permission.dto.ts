import { IsString, IsNotEmpty, IsOptional, Matches } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePermissionDto {
  @ApiProperty({
    example: 'users:read',
    description: 'Nombre del permiso (resource:action)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLengthIfString(255)
  @Matches(/^[a-z_]+:[a-z_]+$/, {
    message:
      'permission_name debe seguir el formato resource:action (lowercase, separado por :)',
  })
  declare permission_name: string;

  @ApiPropertyOptional({ example: 'Ver listado de usuarios' })
  @IsString()
  @IsOptional()
  description?: string;
}
