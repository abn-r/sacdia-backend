import {
  ArrayNotEmpty,
  IsInt,
  IsOptional,
  IsString,
  IsBoolean,
  IsArray,
  IsDateString,
  IsEnum,
  Min,
  Max,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateInRange } from '../../common/utils/honor-date-range';
import {
  InstructorNameField,
  InstructorUserIdField,
} from '../../instructors/instructor-fields';

const HONOR_DATE_CODES = {
  tooOld: 'HONOR_DATE_TOO_OLD',
  inFuture: 'HONOR_DATE_IN_FUTURE',
} as const;

/**
 * Fecha de finalización de la especialidad, 1960-01-01 a hoy (D6). `undefined`
 * = no cambia, `null` = borra. Enviar a revisión la exige solo cuando
 * REQUIRE_HONOR_COMPLETED_AT_ON_SUBMIT es true (hoy false, por las versiones de
 * la app que todavía no la capturan).
 */
function CompletedAtField(): PropertyDecorator {
  const decorators: Array<(target: object, key: string) => void> = [
    ApiPropertyOptional({
      description:
        'Fecha en que el miembro completó la especialidad (yyyy-mm-dd, entre 1960-01-01 y hoy). null la borra. Por ahora es opcional al enviar a revisión; se validará como obligatoria cuando la app que la captura sea la versión mínima. `date` sigue siendo la fecha de inicio.',
      example: '2026-04-12',
      nullable: true,
    }),
    IsOptional(),
    IsDateString({ strict: true }),
    IsDateInRange(HONOR_DATE_CODES),
  ];
  return (target, key) => decorators.forEach((d) => d(target, String(key)));
}

export enum HonorCompletionModeDto {
  UNDECIDED = 'UNDECIDED',
  IN_APP = 'IN_APP',
  EXTERNAL = 'EXTERNAL',
}

export class StartHonorDto {
  @ApiPropertyOptional({ description: 'Fecha de inicio del honor' })
  @IsOptional()
  @IsDateString({ strict: true })
  @IsDateInRange(HONOR_DATE_CODES)
  date?: string;
}

export class UpdateUserHonorDto {
  @ApiPropertyOptional({ description: 'Honor validado por instructor' })
  @IsOptional()
  @IsBoolean()
  validate?: boolean;

  @ApiPropertyOptional({
    description: 'URL del certificado (pasar null o string vacío para limpiar)',
  })
  @IsOptional()
  @IsString()
  certificate?: string | null;

  @ApiPropertyOptional({
    description:
      'URLs de imágenes de evidencia (pasar null o array vacío para limpiar)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[] | null;

  @ApiPropertyOptional({
    description:
      'URL del documento adicional (pasar null o string vacío para limpiar)',
  })
  @IsOptional()
  @IsString()
  document?: string | null;

  @ApiPropertyOptional({
    description:
      'Fecha de inicio del honor (yyyy-mm-dd, entre 1960-01-01 y hoy)',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  @IsDateInRange(HONOR_DATE_CODES)
  date?: string;

  @ApiPropertyOptional({
    description: 'Modo de trabajo elegido para completar el honor',
    enum: HonorCompletionModeDto,
  })
  @IsOptional()
  @IsEnum(HonorCompletionModeDto)
  completionMode?: HonorCompletionModeDto;

  @CompletedAtField()
  completedAt?: string | null;

  @InstructorUserIdField()
  instructorUserId?: string | null;

  @InstructorNameField()
  instructorName?: string | null;
}

export class CreateUserHonorDto {
  @ApiProperty({ description: 'ID del honor/especialidad' })
  @IsInt()
  declare honorId: number;

  @ApiPropertyOptional({ description: 'Fecha de registro/inicio del honor' })
  @IsOptional()
  @IsDateString({ strict: true })
  @IsDateInRange(HONOR_DATE_CODES)
  date?: string;

  @ApiPropertyOptional({ description: 'Honor validado por instructor' })
  @IsOptional()
  @IsBoolean()
  validate?: boolean;

  @ApiPropertyOptional({
    description: 'URL del certificado (pasar null o string vacío para limpiar)',
  })
  @IsOptional()
  @IsString()
  certificate?: string | null;

  @ApiPropertyOptional({
    description: 'URLs de imágenes de evidencia',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[] | null;

  @ApiPropertyOptional({
    description: 'URL del documento adicional',
  })
  @IsOptional()
  @IsString()
  document?: string | null;

  @CompletedAtField()
  completedAt?: string | null;

  @InstructorUserIdField()
  instructorUserId?: string | null;

  @InstructorNameField()
  instructorName?: string | null;
}

export class BulkCreateUserHonorsDto {
  @ApiProperty({
    description: 'Listado de honores a registrar',
    type: [CreateUserHonorDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateUserHonorDto)
  declare honors: CreateUserHonorDto[];
}

export class HonorFiltersDto {
  @ApiPropertyOptional({ description: 'Filtrar por categoría de honor' })
  @IsOptional()
  @IsInt()
  categoryId?: number;

  @ApiPropertyOptional({ description: 'Filtrar por tipo de club' })
  @IsOptional()
  @IsInt()
  clubTypeId?: number;

  @ApiPropertyOptional({
    description:
      'Filtrar por nivel de habilidad (1=Básico, 2=Avanzado, 3=Máster)',
    minimum: 1,
    maximum: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  skillLevel?: number;

  @ApiPropertyOptional({
    description:
      'Texto a buscar en el nombre (y en su traducción), sin distinguir mayúsculas. 2 a 60 caracteres tras recortar espacios. Solo aplica a GET /honors.',
    minLength: 2,
    maxLength: 60,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  search?: string;
}
