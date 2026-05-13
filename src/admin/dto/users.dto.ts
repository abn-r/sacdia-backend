import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { user_approval_status } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

function toBoolean(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export class AdminListUsersQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Búsqueda por nombre/apellidos/email',
    example: 'juan',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por rol global',
    example: 'admin',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  role?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por estado activo',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description: 'Filtrar por unión (solo intersección con scope del actor)',
    example: 12,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unionId?: number;

  @ApiPropertyOptional({
    description:
      'Filtrar por campo local (solo intersección con scope del actor)',
    example: 34,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  localFieldId?: number;

  @ApiPropertyOptional({
    description: 'Número de página (1-indexed)',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Cantidad de elementos por página',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class AdminTrajectoryClassDto {
  @ApiProperty({ example: 101 })
  user_class_id!: number;

  @ApiProperty({ example: 6 })
  class_id!: number;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Amigo',
  })
  class_name!: string | null;

  @ApiProperty({ example: true })
  investiture!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: '2025-11-09',
  })
  date_investiture!: Date | null;

  @ApiProperty({ example: false })
  advanced!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: 'CERT-12345',
  })
  certificate!: string | null;

  @ApiProperty({
    description:
      'Legacy metadata only; not source of current operational truth.',
    example: false,
  })
  current_class!: boolean;
}

export class AdminCurrentOperationalEnrollmentDto {
  @ApiProperty({ example: 4001 })
  enrollment_id!: number;

  @ApiProperty({ example: 2026 })
  ecclesiastical_year_id!: number;

  @ApiProperty({ example: 6 })
  class_id!: number;

  @ApiPropertyOptional({ nullable: true, example: 'Amigo' })
  class_name!: string | null;

  @ApiProperty({ example: '2026-01-08T09:15:00.000Z' })
  enrollment_date!: Date;

  @ApiProperty({ example: 'IN_PROGRESS' })
  investiture_status!: string;

  @ApiProperty({ example: false })
  submitted_for_validation!: boolean;

  @ApiPropertyOptional({ nullable: true, example: null })
  submitted_at!: Date | null;

  @ApiPropertyOptional({ nullable: true, example: null })
  validated_by!: string | null;

  @ApiPropertyOptional({ nullable: true, example: null })
  validated_at!: Date | null;

  @ApiPropertyOptional({ nullable: true, example: null })
  rejection_reason!: string | null;

  @ApiPropertyOptional({ nullable: true, example: null })
  investiture_date!: Date | null;

  @ApiPropertyOptional({ nullable: true, example: false })
  advanced_status!: boolean | null;

  @ApiProperty({ example: false })
  locked_for_validation!: boolean;

  @ApiProperty({ example: false })
  cross_type_enrollment!: boolean;

  @ApiProperty({ example: true })
  active!: boolean;
}

export class UpdateUserApprovalDto {
  @ApiProperty({
    description: 'true para aprobar al usuario, false para rechazarlo',
    example: true,
  })
  @IsBoolean()
  approved!: boolean;

  @ApiPropertyOptional({
    description: 'Motivo del rechazo cuando corresponda',
    example: 'Falta documentación',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejection_reason?: string;
}

/**
 * The full list of allowed global role slugs for admin-initiated user creation.
 * `super-admin` is intentionally excluded — defense in depth.
 */
export const ALLOWED_CREATION_ROLES = [
  'user',
  'coordinator',
  'zone-coordinator',
  'general-coordinator',
  'pastor',
  'assistant-lf',
  'director-lf',
  'assistant-union',
  'director-union',
  'assistant-dia',
  'director-dia',
  'admin',
] as const;

export class CreateAdminUserDto {
  @ApiProperty({ example: 'Juan', description: 'Nombre del usuario (1-50 caracteres)' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @ApiProperty({ example: 'Pérez', description: 'Apellido paterno (1-50 caracteres)' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  paternal_last_name!: string;

  @ApiPropertyOptional({ example: 'García', description: 'Apellido materno (opcional, máx 50 caracteres)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  maternal_last_name?: string;

  @ApiProperty({ example: 'juan.perez@example.com', description: 'Email único del usuario (máx 120 caracteres)' })
  @IsEmail()
  @MaxLength(120)
  email!: string;

  @ApiProperty({
    example: 'director-lf',
    description: 'Rol global a asignar. super-admin no está permitido por este endpoint.',
    enum: ALLOWED_CREATION_ROLES,
  })
  @IsString()
  @IsIn([...ALLOWED_CREATION_ROLES])
  role!: string;

  @ApiPropertyOptional({ example: 1, description: 'ID de país (opcional)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  country_id?: number;

  @ApiPropertyOptional({ example: 2, description: 'ID de unión (opcional)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  union_id?: number;

  @ApiPropertyOptional({ example: 10, description: 'ID de campo local (opcional)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  local_field_id?: number;
}

export class CreateAdminUserResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000', description: 'UUID del usuario creado' })
  user_id!: string;

  @ApiProperty({ example: 'juan.perez@example.com', description: 'Email del usuario creado' })
  email!: string;

  @ApiProperty({ example: true, description: 'true si el email de invitación fue encolado exitosamente' })
  invite_email_sent!: boolean;
}

export class UpdateAdminUserDto {
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  access_app?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  access_panel?: boolean;

  @ApiPropertyOptional({
    enum: user_approval_status,
    example: user_approval_status.approved,
  })
  @IsOptional()
  @IsEnum(user_approval_status)
  approval_status?: user_approval_status;

  @ApiPropertyOptional({
    description: 'Motivo de rechazo administrativo',
    example: 'Perfil incompleto',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejection_reason?: string;
}
