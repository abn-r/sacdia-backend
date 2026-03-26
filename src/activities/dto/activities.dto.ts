import {
  IsInt,
  IsOptional,
  IsString,
  IsBoolean,
  IsNumber,
  IsArray,
  IsDateString,
  ValidateIf,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

function IsAfterOrEqualDate(
  property: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isAfterOrEqualDate',
      target: (object as any).constructor,
      propertyName,
      options: validationOptions,
      constraints: [property],
      validator: {
        validate(value: any, args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints as string[];
          const relatedValue = (args.object as any)[relatedPropertyName];
          if (!value || !relatedValue) return true;
          return new Date(value) >= new Date(relatedValue);
        },
        defaultMessage(args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints as string[];
          return `${args.property} must be greater than or equal to ${relatedPropertyName}`;
        },
      },
    });
  };
}

export class CreateActivityDto {
  @ApiProperty({ description: 'Nombre de la actividad' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Descripción de la actividad' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Tipo de club (1=Aventureros, 2=Conquistadores, 3=GM)',
  })
  @IsInt()
  club_type_id: number;

  @ApiProperty({ description: 'Latitud del lugar' })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ description: 'Longitud del lugar' })
  @IsNumber()
  @Min(-180)
  @Max(180)
  long: number;

  @ApiPropertyOptional({
    description: 'Hora de la actividad (HH:mm)',
    default: '09:00',
  })
  @IsOptional()
  @IsString()
  activity_time?: string;

  @ApiPropertyOptional({
    description: 'Fecha de la actividad (ISO date: YYYY-MM-DD)',
    example: '2025-06-15',
  })
  @IsOptional()
  @IsDateString()
  activity_date?: string;

  @ApiPropertyOptional({
    description:
      'Fecha de fin de la actividad (ISO date: YYYY-MM-DD). Debe ser >= activity_date.',
    example: '2025-06-17',
  })
  @IsOptional()
  @ValidateIf((o) => o.activity_end_date !== undefined)
  @IsDateString()
  @IsAfterOrEqualDate('activity_date', {
    message: 'activity_end_date debe ser mayor o igual a activity_date',
  })
  activity_end_date?: string;

  @ApiProperty({ description: 'Lugar de la actividad' })
  @IsString()
  activity_place: string;

  @ApiPropertyOptional({ description: 'URL de la imagen de la actividad' })
  @IsOptional()
  @IsString()
  image?: string;

  @ApiPropertyOptional({
    description: 'Plataforma (0=Presencial, 1=Virtual, 2=Híbrido)',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  platform?: number;

  @ApiProperty({
    description:
      'ID del tipo de actividad (catálogo activity_types: 1=Regular, 2=Especial, 3=Camporee)',
  })
  @IsInt()
  activity_type_id: number;

  @ApiPropertyOptional({ description: 'Link de reunión virtual' })
  @IsOptional()
  @IsString()
  link_meet?: string;

  @ApiPropertyOptional({ description: 'Datos adicionales en JSON' })
  @IsOptional()
  @IsString()
  additional_data?: string;

  @ApiPropertyOptional({ description: 'Clases invitadas (IDs)' })
  @IsOptional()
  @IsArray()
  classes?: number[];

  @ApiProperty({
    description: 'ID de la sección del club (FK a club_sections)',
  })
  @Type(() => Number)
  @IsInt()
  club_section_id: number;
}

export class UpdateActivityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  lat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  long?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  activity_time?: string;

  @ApiPropertyOptional({
    description: 'Fecha de la actividad (ISO date: YYYY-MM-DD)',
    example: '2025-06-15',
  })
  @IsOptional()
  @IsDateString()
  activity_date?: string;

  @ApiPropertyOptional({
    description:
      'Fecha de fin de la actividad (ISO date: YYYY-MM-DD). Debe ser >= activity_date.',
    example: '2025-06-17',
  })
  @IsOptional()
  @ValidateIf((o) => o.activity_end_date !== undefined)
  @IsDateString()
  @IsAfterOrEqualDate('activity_date', {
    message: 'activity_end_date debe ser mayor o igual a activity_date',
  })
  activity_end_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  activity_place?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  image?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  platform?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  activity_type_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  link_meet?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  classes?: number[];
}

export class RecordAttendanceDto {
  @ApiProperty({ description: 'Lista de IDs de usuarios que asistieron' })
  @IsArray()
  user_ids: string[];
}

export class ActivityFiltersDto {
  @ApiPropertyOptional({ description: 'Filtrar por tipo de club' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  clubTypeId?: number;

  @ApiPropertyOptional({ description: 'Solo actividades activas' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'Tipo de actividad' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  activityTypeId?: number;
}
