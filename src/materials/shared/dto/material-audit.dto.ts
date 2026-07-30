import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class MaterialAuditQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  local_field_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entity_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

export class MaterialAuditDto {
  @ApiProperty() declare id: string;
  @ApiProperty() declare local_field_id: number;
  @ApiProperty() @IsUUID() declare actor_user_id: string;
  @ApiProperty() declare entity_type: string;
  @ApiProperty() declare entity_id: string;
  @ApiProperty() declare action: string;
  @ApiPropertyOptional({ nullable: true }) before_json?: Record<
    string,
    unknown
  > | null;
  @ApiPropertyOptional({ nullable: true }) after_json?: Record<
    string,
    unknown
  > | null;
  @ApiProperty() declare created_at: Date;
}
