import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  MaxLength,
  IsObject,
  IsArray,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateClubDto {
  @ApiProperty({ example: 'Club Central', description: 'Nombre del club' })
  @IsString()
  @MaxLength(50)
  declare name: string;

  @ApiPropertyOptional({ description: 'Descripción del club' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 1, description: 'ID del campo local' })
  @IsInt()
  declare local_field_id: number;

  @ApiProperty({ example: 1, description: 'ID del distrito' })
  @IsInt()
  declare districlub_type_id: number;

  @ApiProperty({ example: 1, description: 'ID de la iglesia' })
  @IsInt()
  declare church_id: number;

  @ApiPropertyOptional({ description: 'Dirección del club' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({
    example: { lat: 19.4326, lng: -99.1332 },
    description: 'Coordenadas del club',
  })
  @IsOptional()
  @IsObject()
  coordinates?: { lat: number; lng: number };

  @ApiProperty({
    type: [Number],
    example: [1, 2],
    description:
      'IDs de club_types a habilitar. El backend crea una sección por cada tipo activo del catálogo; estos IDs marcan active=true. Mínimo uno.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsInt({ each: true })
  declare enabled_club_type_ids: number[];
}

export class UpdateClubDto {
  @ApiPropertyOptional({ example: 'Club Actualizado' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  coordinates?: { lat: number; lng: number };

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
