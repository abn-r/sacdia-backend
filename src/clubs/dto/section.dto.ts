import {
  IsInt,
  IsOptional,
  IsArray,
  IsBoolean,
  IsString,
  IsNumber,
  IsEmail,
  IsUrl,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateClubSectionDto {
  @ApiProperty({
    example: 2,
    description: 'ID del tipo de club (FK a club_types)',
  })
  @Type(() => Number)
  @IsInt()
  club_type_id: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  souls_target?: number;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fee?: number;

  @ApiPropertyOptional({ example: [{ day: 'Saturday' }] })
  @IsOptional()
  @IsArray()
  meeting_day?: Record<string, unknown>[];

  @ApiPropertyOptional({ example: [{ time: '09:00' }] })
  @IsOptional()
  @IsArray()
  meeting_time?: Record<string, unknown>[];
}

export class UpdateClubSectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  souls_target?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  meeting_day?: Record<string, unknown>[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  meeting_time?: Record<string, unknown>[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: 'Club Conquistadores Central' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '+541112345678' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'contacto@clubcentral.org' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'https://clubcentral.org' })
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/logos/club.png' })
  @IsOptional()
  @IsString()
  logo_url?: string;

  @ApiPropertyOptional({ example: 'Av. Corrientes 1234, Buenos Aires' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: -34.603722 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lat?: number;

  @ApiPropertyOptional({ example: -58.381592 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  long?: number;
}
