import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCountryDto {
  @ApiProperty({ example: 'México' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiProperty({ example: 'MX' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  abbreviation: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateCountryDto {
  @ApiPropertyOptional({ example: 'México' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: 'MX' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  abbreviation?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateUnionDto {
  @ApiProperty({ example: 'Unión Mexicana del Norte' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiProperty({ example: 'UMN' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  abbreviation: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  country_id: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateUnionDto {
  @ApiPropertyOptional({ example: 'Unión Mexicana del Norte' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: 'UMN' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  abbreviation?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  country_id?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateLocalFieldDto {
  @ApiProperty({ example: 'Campo Norte' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiProperty({ example: 'CN' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  abbreviation: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  union_id: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateLocalFieldDto {
  @ApiPropertyOptional({ example: 'Campo Norte' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: 'CN' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  abbreviation?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  union_id?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateDistrictDto {
  @ApiProperty({ example: 'Distrito Norte' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  local_field_id: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateDistrictDto {
  @ApiPropertyOptional({ example: 'Distrito Norte' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  local_field_id?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateChurchDto {
  @ApiProperty({ example: 'Iglesia Central' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  district_id: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateChurchDto {
  @ApiPropertyOptional({ example: 'Iglesia Central' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  district_id?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
