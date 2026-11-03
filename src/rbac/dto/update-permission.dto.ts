import { IsString, IsOptional, IsBoolean, Matches } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePermissionDto {
  @ApiPropertyOptional({ example: 'users:read_detail' })
  @IsString()
  @IsOptional()
  @MaxLengthIfString(255)
  @Matches(/^[a-z_]+:[a-z_]+$/, {
    message:
      'permission_name debe seguir el formato resource:action (lowercase, separado por :)',
  })
  permission_name?: string;

  @ApiPropertyOptional({ example: 'Ver detalle de un usuario' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
