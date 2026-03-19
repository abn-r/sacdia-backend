import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { user_approval_status } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
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
