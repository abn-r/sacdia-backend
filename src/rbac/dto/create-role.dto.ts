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
    example: 'club-treasurer',
    description:
      'Nombre del rol. Solo letras minúsculas y guiones. No puede ser "super-admin".',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-z][a-z-]*[a-z]$/, {
    message:
      'role_name debe contener solo letras minúsculas y guiones (no puede empezar ni terminar con guión)',
  })
  declare role_name: string;

  @ApiProperty({
    example: 'Rol encargado de la tesorería del club',
    description: 'Descripción del rol (10–500 caracteres)',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(500)
  declare description: string;

  @ApiProperty({
    enum: RoleCategoryEnum,
    example: 'CLUB',
    description: 'Categoría del rol: GLOBAL o CLUB',
  })
  @IsEnum(RoleCategoryEnum, {
    message: 'role_category debe ser GLOBAL o CLUB',
  })
  declare role_category: RoleCategoryEnum;

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
