import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsUUID,
  IsEnum,
  Matches,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum RoleCategoryEnum {
  GLOBAL = 'GLOBAL',
  CLUB = 'CLUB',
}

export class CreateRoleDto {
  @ApiProperty({
    example: 'club_treasurer',
    description:
      'Nombre del rol. Solo letras minúsculas y guiones bajos. No puede ser "super_admin".',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-z_]+$/, {
    message: 'role_name debe contener solo letras minúsculas y guiones bajos',
  })
  role_name: string;

  @ApiProperty({
    example: 'Rol encargado de la tesorería del club',
    description: 'Descripción del rol (10–500 caracteres)',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(500)
  description: string;

  @ApiProperty({
    enum: RoleCategoryEnum,
    example: 'CLUB',
    description: 'Categoría del rol: GLOBAL o CLUB',
  })
  @IsEnum(RoleCategoryEnum, {
    message: 'role_category debe ser GLOBAL o CLUB',
  })
  role_category: RoleCategoryEnum;

  @ApiPropertyOptional({
    example: ['uuid-1', 'uuid-2'],
    description: 'IDs de permisos a asignar al crear el rol (opcional)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  permission_ids?: string[];
}
