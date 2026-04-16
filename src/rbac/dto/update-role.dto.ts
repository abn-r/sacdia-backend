import {
  IsString,
  IsOptional,
  IsArray,
  IsUUID,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateRoleDto {
  @ApiPropertyOptional({
    example: 'Rol con permisos de tesorería ampliados',
    description: 'Nueva descripción del rol (10–500 caracteres)',
  })
  @IsString()
  @IsOptional()
  @MinLength(10)
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: ['uuid-1', 'uuid-2'],
    description:
      'Si se provee, SINCRONIZA (reemplaza) todos los permisos del rol con esta lista',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  permission_ids?: string[];

  // role_name is intentionally absent — it is immutable after creation.
  // The service layer enforces a 400 if the client sends it.
}
