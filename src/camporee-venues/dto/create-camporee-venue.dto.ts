import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCamporeeVenueDto {
  @ApiProperty({ example: 'union', enum: ['union', 'local_field'] })
  @IsString()
  @IsIn(['union', 'local_field'])
  declare scope: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  union_id?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  local_field_id?: number;

  @ApiProperty({ example: 'Anfiteatro Central' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  declare name: string;

  @ApiPropertyOptional({ example: 'Sala principal del campamento' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @IsInt()
  @Min(0)
  capacity?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
