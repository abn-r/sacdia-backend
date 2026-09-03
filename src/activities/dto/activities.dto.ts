import {
  IsInt,
  IsOptional,
  IsString,
  IsBoolean,
  IsNumber,
  IsArray,
  ArrayMinSize,
  IsDateString,
  ValidateIf,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  Min,
  Max,
  Matches,
  IsUrl,
  IsUUID,
  IsIn,
  ArrayMaxSize,
  ValidateNested,
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
  declare name: string;

  @ApiPropertyOptional({ description: 'Descripción de la actividad' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'Tipo de club (1=Aventureros, 2=Conquistadores, 3=GM). Opcional: si se omite se deriva de la sección.',
  })
  @IsOptional()
  @IsInt()
  club_type_id?: number;

  @ApiProperty({ description: 'Latitud del lugar' })
  @IsNumber()
  @Min(-90)
  @Max(90)
  declare lat: number;

  @ApiProperty({ description: 'Longitud del lugar' })
  @IsNumber()
  @Min(-180)
  @Max(180)
  declare long: number;

  @ApiPropertyOptional({
    description: 'Hora de la actividad (HH:mm)',
    default: '09:00',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'activity_time must be in HH:mm format',
  })
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
  declare activity_place: string;

  @ApiPropertyOptional({ description: 'URL de la imagen de la actividad' })
  @IsOptional()
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'image must be a valid URL' },
  )
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
  declare activity_type_id: number;

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

  @ApiPropertyOptional({
    description:
      'ID de la sección del club (FK a club_sections). Requerido para actividades de una sola sección.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  club_section_id?: number;

  @ApiPropertyOptional({
    description:
      'IDs de las secciones participantes en la actividad conjunta (mínimo 2). Cuando se envía, crea una actividad joint con is_joint=true.',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2, {
    message:
      'club_section_ids debe tener al menos 2 secciones para una actividad conjunta',
  })
  @IsInt({ each: true })
  club_section_ids?: number[];

  @ApiPropertyOptional({
    description:
      'Indica si la actividad es conjunta entre múltiples secciones. Se establece automáticamente en true cuando se provee club_section_ids.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  is_joint?: boolean;
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
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'activity_time must be in HH:mm format',
  })
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
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'image must be a valid URL' },
  )
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

  @ApiPropertyOptional({
    description:
      'IDs de las secciones participantes en la actividad conjunta (mínimo 2). Reemplaza las instancias actuales de forma atómica.',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2, {
    message:
      'club_section_ids debe tener al menos 2 secciones para una actividad conjunta',
  })
  @IsInt({ each: true })
  club_section_ids?: number[];

  @ApiPropertyOptional({
    description:
      'Indica si la actividad es conjunta. Enviar false para convertir una actividad conjunta en actividad de sección única (se desactivan las instancias extra).',
  })
  @IsOptional()
  @IsBoolean()
  is_joint?: boolean;
}

export class RecurrenceDto {
  @ApiProperty({ enum: ['interval', 'weekly'] })
  @IsIn(['interval', 'weekly'])
  declare kind: 'interval' | 'weekly';

  @ApiPropertyOptional({ description: 'Cada N días (1-365). Requerido si kind=interval.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  interval_days?: number;

  @ApiPropertyOptional({
    description:
      'Días ISO 8601 (1=lunes … 7=domingo). En v1 exactamente un valor si kind=weekly.',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  weekdays?: number[];

  @ApiPropertyOptional({
    description: 'Fecha límite inclusive (YYYY-MM-DD). Si se omite, fin del año eclesiástico activo.',
  })
  @IsOptional()
  @IsDateString()
  until?: string;
}

export class CreateActivitySeriesDto extends CreateActivityDto {
  @ApiProperty({ type: RecurrenceDto })
  @ValidateNested()
  @Type(() => RecurrenceDto)
  declare recurrence: RecurrenceDto;
}

export class ExtendActivitySeriesDto {
  @ApiProperty({ description: 'Nueva fecha límite inclusive (YYYY-MM-DD)' })
  @IsDateString()
  declare until: string;
}

export class RecordAttendanceDto {
  @ApiProperty({ description: 'Lista de IDs de usuarios que asistieron' })
  @IsArray()
  @IsUUID('4', { each: true })
  declare user_ids: string[];
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

  @ApiPropertyOptional({ description: 'Filtrar por serie de actividades' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  seriesId?: number;
}
