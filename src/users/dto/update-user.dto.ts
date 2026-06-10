import {
  IsOptional,
  IsString,
  IsIn,
  IsDateString,
  IsBoolean,
  ValidateIf,
  IsEnum,
  IsInt,
  Min,
  MaxLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { blood_type } from '@prisma/client';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Carlos' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Mendoza' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  paternal_last_name?: string;

  @ApiPropertyOptional({ example: 'Ruiz' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  maternal_last_name?: string;

  @ApiPropertyOptional({ example: '+52 55 1234 5678' })
  @IsOptional()
  @IsString()
  @MaxLength(25)
  @Matches(/^\+?[\d\s\-(). ext]{7,25}$/, {
    message: 'phone must be a valid phone number',
  })
  phone?: string;

  @ApiPropertyOptional({ example: 'Av. Reforma 123, CDMX' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ example: 'M', enum: ['M', 'F'] })
  @IsOptional()
  @IsIn(['M', 'F'])
  gender?: 'M' | 'F';

  @ApiPropertyOptional({
    example: '2000-01-15',
    description: 'Fecha de nacimiento (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsDateString()
  birthday?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  baptism?: boolean;

  @ApiPropertyOptional({
    example: '2015-06-20',
    description: 'Fecha de bautismo (requerido si baptism=true)',
  })
  @IsOptional()
  @IsDateString()
  @ValidateIf((o) => o.baptism === true)
  baptism_date?: string;

  @ApiPropertyOptional({
    example: 'A_POSITIVE',
    enum: blood_type,
    description: 'Tipo de sangre',
  })
  @IsOptional()
  @IsEnum(blood_type)
  blood?: blood_type;

  @ApiPropertyOptional({
    example: 1,
    description:
      'Solo lectura en actualización self-service. Usar flujo administrativo para cambios territoriales.',
    deprecated: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  country_id?: number;

  @ApiPropertyOptional({
    example: 1,
    description:
      'Solo lectura en actualización self-service. Usar flujo administrativo para cambios territoriales.',
    deprecated: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  union_id?: number;

  @ApiPropertyOptional({
    example: 1,
    description:
      'Solo lectura en actualización self-service. Usar flujo administrativo para cambios territoriales.',
    deprecated: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  local_field_id?: number;
}
