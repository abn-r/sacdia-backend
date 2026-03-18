import { IsInt, IsOptional, IsArray, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateClubSectionDto {
  @ApiProperty({ example: 2, description: 'ID del tipo de club (FK a club_types)' })
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
}
